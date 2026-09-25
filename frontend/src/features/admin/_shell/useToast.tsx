import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export interface ToastOptions {
  /** Offered for ten seconds; the toast says "Undo". */
  undo?: () => void | Promise<void>;
  /** Milliseconds before it goes away on its own. */
  duration?: number;
}

interface Toast extends ToastOptions {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ToastApi {
  show: (kind: ToastKind, text: string, options?: ToastOptions) => void;
  success: (text: string, options?: ToastOptions) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const noop: ToastApi = {
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
};

const ToastContext = createContext<ToastApi>(noop);

/** Shows a message at the bottom of the admin; works without a provider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const DEFAULT_DURATION = 5_000;
const UNDO_DURATION = 10_000;

/**
 * One toast for the whole admin. Errors stay until dismissed; everything
 * else goes away on its own, later when it offers an undo.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (kind: ToastKind, text: string, options?: ToastOptions) => {
      const id = nextId.current++;
      const toast: Toast = { id, kind, text, ...options };
      setToasts((list) => [...list.slice(-2), toast]);
      const duration =
        options?.duration ??
        (kind === "error"
          ? 0
          : options?.undo
            ? UNDO_DURATION
            : DEFAULT_DURATION);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (text, options) => show("success", text, options),
      error: (text) => show("error", text),
      info: (text) => show("info", text),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="toast toast-center toast-bottom pointer-events-none z-50 w-full max-w-md px-4 pb-20 sm:pb-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`alert pointer-events-auto w-full text-sm shadow-lg ${
              t.kind === "error"
                ? "alert-error"
                : t.kind === "success"
                  ? "alert-success"
                  : ""
            }`}
          >
            <span className="min-w-0 flex-1 whitespace-normal">{t.text}</span>
            {t.undo && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  dismiss(t.id);
                  void t.undo?.();
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
