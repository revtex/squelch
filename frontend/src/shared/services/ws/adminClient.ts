import type { AppDispatch } from "@/app/store";
import { clearCredentials } from "@/features/auth";
import type {
  WsAdminInbound,
  WsAdminOutbound,
  WsAdminResponse,
} from "@/shared/types/ws";

type TokenExpiredCallback = () => Promise<string | null>;
type EventCallback = (topic: string, data: unknown, at: number) => void;

/**
 * Where the admin socket is: `connected` once the server accepted the token,
 * `connecting` while a handshake or a reconnect wait is in progress, and
 * `offline` after an intentional close. Reported through the `__status__`
 * topic so the chrome can show it.
 */
export type AdminWsStatus = "connecting" | "connected" | "offline";

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT = 30_000;
const MAX_BACKOFF = 30_000;

class AdminWsClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private dispatch: AppDispatch | null = null;
  private token: string | null = null;
  private intentionalClose = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventListeners = new Map<string, Set<EventCallback>>();
  private tokenExpiredCallback: TokenExpiredCallback | null = null;
  private connected = false;
  private status: AdminWsStatus = "offline";
  private wakeHandlersBound = false;

  connect(dispatch: AppDispatch, token: string): void {
    this.dispatch = dispatch;
    this.token = token;
    this.intentionalClose = false;
    this.bindWakeHandlers();
    this.doConnect();
  }

  getStatus(): AdminWsStatus {
    return this.status;
  }

  private setStatus(next: AdminWsStatus): void {
    if (this.status === next) return;
    this.status = next;
    const listeners = this.eventListeners.get("__status__");
    if (listeners) {
      for (const cb of listeners) cb("__status__", next, Date.now());
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Reject all pending requests
    for (const [reqId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("WebSocket disconnected"));
      this.pendingRequests.delete(reqId);
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.setStatus("offline");
  }

  request<T = unknown>(
    op: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Admin WebSocket is not connected"));
        return;
      }

      const reqId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Admin WS request timed out: ${op}`));
      }, timeoutMs ?? REQUEST_TIMEOUT);

      this.pendingRequests.set(reqId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });

      const msg: WsAdminOutbound = {
        type: "admin.request",
        reqId,
        op,
        ...(params !== undefined ? { params } : {}),
      };
      this.ws.send(JSON.stringify(msg));
    });
  }

  on(topic: string, callback: EventCallback): () => void {
    let listeners = this.eventListeners.get(topic);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(topic, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners?.delete(callback);
      if (listeners?.size === 0) {
        this.eventListeners.delete(topic);
      }
    };
  }

  onAny(callback: EventCallback): () => void {
    return this.on("*", callback);
  }

  onTokenExpired(cb: TokenExpiredCallback): void {
    this.tokenExpiredCallback = cb;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private doConnect(): void {
    if (this.ws) {
      const old = this.ws;
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      // If the previous socket hasn't finished its handshake yet,
      // calling close() on it makes the browser log a noisy
      // "WebSocket is closed before the connection is established"
      // warning that's purely cosmetic. Detach handlers and let it
      // settle on its own — once OPEN, close it cleanly.
      if (old.readyState === WebSocket.CONNECTING) {
        old.onopen = () => old.close();
      } else if (old.readyState === WebSocket.OPEN) {
        old.close();
      }
      this.ws = null;
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/api/v1/ws/admin`;

    this.ws = new WebSocket(url);
    this.setStatus("connecting");

    this.ws.onopen = () => {
      // Send JWT as first message for auth (token never appears in URL).
      if (this.token && this.ws) {
        this.ws.send(JSON.stringify([this.token]));
      }
      this.backoff = 1000;
      this.connected = true;
      this.setStatus("connected");
      // Emit connection event so hooks can re-fetch
      const connListeners = this.eventListeners.get("__connected__");
      if (connListeners) {
        for (const cb of connListeners) {
          cb("__connected__", null, Date.now());
        }
      }
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      this.handleMessage(ev.data as string);
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (!this.intentionalClose) {
        this.setStatus("connecting");
        this.scheduleReconnect();
      } else {
        this.setStatus("offline");
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, reconnect is handled there
    };
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("Admin WS: failed to parse message");
      return;
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as { type?: unknown }).type !== "string"
    ) {
      return;
    }

    const msg = parsed as WsAdminInbound;

    switch (msg.type) {
      case "admin.response":
        this.handleResponse(msg);
        break;
      case "admin.event":
        this.handleEvent(msg.topic, msg.data, msg.at);
        break;
      case "session.expired":
        this.handleTokenExpired();
        break;
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
        break;
      }
    }
  }

  private handleResponse(payload: WsAdminResponse): void {
    const pending = this.pendingRequests.get(payload.reqId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(payload.reqId);

    if (payload.ok) {
      pending.resolve(payload.data);
    } else {
      // Surface the v1 error envelope through the promise. Code is
      // attached so callers can branch on validation_failed vs
      // unknown_op vs internal_error without parsing the message string.
      const err = new Error(
        payload.error?.message ?? "Unknown admin WS error",
      ) as Error & { code?: string; details?: unknown };
      err.code = payload.error?.code;
      err.details = payload.error?.details;
      pending.reject(err);
    }
  }

  private handleEvent(topic: string, data: unknown, at: number): void {
    // Notify topic-specific listeners
    const topicListeners = this.eventListeners.get(topic);
    if (topicListeners) {
      for (const cb of topicListeners) {
        cb(topic, data, at);
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.eventListeners.get("*");
    if (wildcardListeners) {
      for (const cb of wildcardListeners) {
        cb(topic, data, at);
      }
    }
  }

  private handleTokenExpired(): void {
    if (!this.tokenExpiredCallback) {
      this.disconnect();
      this.dispatch?.(clearCredentials());
      return;
    }

    this.tokenExpiredCallback()
      .then((newToken) => {
        if (newToken) {
          this.token = newToken;
          this.doConnect();
        } else {
          this.disconnect();
          this.dispatch?.(clearCredentials());
        }
      })
      .catch(() => {
        this.disconnect();
        this.dispatch?.(clearCredentials());
      });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    // Exponential backoff with jitter
    const jitter = Math.random() * this.backoff * 0.3;
    const delay = Math.min(this.backoff + jitter, MAX_BACKOFF);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.doConnect();
    }, delay);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  /**
   * Force an immediate reconnect, bypassing any pending backoff timer.
   * Used by visibility/online handlers — iOS Safari throttles setTimeout
   * on backgrounded pages and silently kills WebSockets when the page is
   * suspended, so when the page returns to focus we want to reconnect
   * right away rather than waiting out the (possibly maxed-out) backoff.
   */
  private wake = (): void => {
    if (this.intentionalClose) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.backoff = 1000;
    this.doConnect();
  };

  private bindWakeHandlers(): void {
    if (this.wakeHandlersBound) return;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.wake);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.wake);
      window.addEventListener("focus", this.wake);
    }
    this.wakeHandlersBound = true;
  }
}

export const adminWsClient = new AdminWsClient();
