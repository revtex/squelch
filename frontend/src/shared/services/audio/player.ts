import type { Call } from "@/features/scanner";
import { bootstrapBeepContext } from "@/shared/services/audio/beep";
import { streamPlayer } from "@/shared/services/audio/streamPlayer";

interface QueueItem {
  call: Call;
  /** True for search/bookmark plays — discardable on a newer playNow. */
  onDemand?: boolean;
  /**
   * Set after we've already attempted a silent auth refresh + retry for
   * this item. Prevents an infinite refresh loop when the failure isn't
   * actually about auth.
   */
  recoveryTried?: boolean;
}

/** HTMLMediaElement.readyState values used by the stall recovery. */
const HAVE_NOTHING = 0;
const HAVE_FUTURE_DATA = 3;

// Extend window for Safari's prefixed AudioContext.
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * Build the on-demand audio URL for a call. The server authenticates the
 * request via the `os_session` cookie issued at login/refresh; no JS-side
 * header injection is required.
 */
function audioUrlFor(call: Call): string {
  return `/api/v1/calls/${call.id}/audio`;
}

/**
 * Choose a sensible filename for downloads triggered by the player.
 */
function downloadNameFor(call: Call): string {
  const name = call.audioName || `call-${call.id}`;
  return /\.\w+$/.test(name) ? name : `${name}.mp3`;
}

/**
 * True where the call audio must come straight out of the media element
 * rather than through the Web Audio graph.
 *
 * iOS renders Web Audio output on a channel the hardware ring/silent
 * switch mutes, while plain media-element playback is unaffected by it.
 * Routing the element through MediaElementAudioSourceNode therefore makes
 * every call silent on a phone whose side switch is set to silent — the
 * call arrives, the element plays, its currentTime advances, and nothing
 * is audible. WebKit has also long produced silence for remote media
 * routed through an element source. The cost of staying off the graph is
 * software volume control, which iOS does not offer anyway:
 * HTMLMediaElement.volume is ignored there and volume is a hardware-only
 * control.
 */
function needsDirectElementOutput(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iP(hone|od|ad)/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports a desktop user agent; touch points disambiguate it.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

class AudioPlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  /** Element output is not routed through the Web Audio graph. */
  private directOutput = false;
  private audio: HTMLAudioElement | null = null;
  private volume = 1;
  private queue: QueueItem[] = [];
  private currentItem: QueueItem | null = null;
  /** The last Call started, kept after it ends so Replay has something to
   *  replay — which is exactly when anyone reaches for it. */
  private lastItem: QueueItem | null = null;
  private _paused = false;
  private _playing = false;
  private callStartCb: ((call: Call) => void) | null = null;
  private callEndCb: (() => void) | null = null;
  private queueChangeCb: ((length: number) => void) | null = null;
  private authRecovery: (() => Promise<boolean>) | null = null;
  /**
   * True while the server's continuous stream owns playback. iOS lets only
   * one media element hold the audio session, so anything this player does
   * to its own element — including the gesture unlock, which fires on every
   * tap — takes the session away from the stream and silences it. While
   * suspended this player touches nothing.
   */
  private suspended = false;
  /**
   * Set while an on-demand call (search / bookmarks) is borrowing playback
   * from the server stream, so the stream can be re-opened when it ends.
   * Only one media element may hold the audio session on iOS, so the two
   * must take turns rather than compete — the same conflict that made LIVE
   * and the stream fight.
   */
  private streamBorrowed = false;
  /** Removes the gesture-unlock listeners; retained so they can be detached. */
  private removeUnlockListeners: (() => void) | null = null;

  constructor() {
    this.bootstrapAudio();
    this.bindMediaSessionActions();
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
  }

  /**
   * Attach gesture listeners so that the AudioContext is created/resumed
   * and the persistent <audio> element is unlocked inside a user-gesture
   * handler — required by mobile browsers (Android Edge/Chrome, iOS
   * Safari) that enforce strict autoplay policies. The unlock plays an
   * empty source then immediately pauses, leaving the element in a state
   * where subsequent programmatic play() calls succeed.
   */
  private bootstrapAudio(): void {
    const events: Array<keyof DocumentEventMap> = [
      "mousedown",
      "touchstart",
      "keydown",
    ];

    // Not async, and nothing below is awaited before the unlock calls are
    // issued. WebKit only treats play()/resume() as gesture-initiated while
    // the handler still holds transient user activation, and that activation
    // does not survive an `await` the way Chrome's sticky activation does.
    // Awaiting the context resume first left the element unlock running in a
    // microtask that iOS no longer counted as a gesture, so playback stayed
    // blocked for the whole session — including calls played from history.
    const handler = () => {
      this.ensureContext();
      this.ensureAudioElement();

      // Unlock the <audio> element first: it is the one call playback needs.
      // Deliberately not awaited: play() on an element with no source does
      // not settle until a source arrives, so `await` here hung the rest of
      // this handler until a real call replaced the src (AbortError, ~30s
      // later).
      if (this.audio && !this.currentItem) {
        const el = this.audio;
        // Wrapped rather than chained directly: play() is specified to
        // return a promise, but jsdom returns undefined, and this handler
        // runs on every stray interaction in component tests.
        void Promise.resolve(el.play())
          .then(() => {
            // Only undo *our own* unlock. A source-less play() does not
            // reject — it stays pending until a source arrives — so by the
            // time this settles a real call has usually taken the element
            // over. Pausing then stopped that call dead, and because
            // `ended` never fires on a paused element the queue stalled
            // for the rest of the session: every later call piled up
            // silently until something else (playing a call from search)
            // replaced the stuck item.
            if (!this.currentItem && !el.src) el.pause();
          })
          .catch(() => {
            // ignore — the element still counts as user-activated on
            // most browsers once a gesture-scoped play() was attempted.
          });
      }

      // Both contexts are created/resumed by calls made synchronously here;
      // only the settling is deferred.
      const ctx = this.ctx;
      const resumed =
        ctx && ctx.state === "suspended"
          ? ctx.resume().catch(() => {
              // ignore
            })
          : Promise.resolve();

      void bootstrapBeepContext();

      void resumed.then(() => {
        if (this.ctx?.state === "running" && this.audio) {
          for (const e of events) {
            document.body.removeEventListener(e, handler);
          }
        }
      });
    };

    for (const e of events) {
      document.body.addEventListener(e, handler);
    }
    this.removeUnlockListeners = () => {
      for (const e of events) {
        document.body.removeEventListener(e, handler);
      }
    };
  }

  /**
   * Hand playback over to (or take it back from) the server stream.
   *
   * Suspending has to do more than stop enqueuing: on iOS the gesture
   * unlock re-plays this player's element on every tap, which steals the
   * audio session from the stream element and leaves both silent. So the
   * unlock listeners come off, the queue is dropped, and the element is
   * released.
   */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;

    if (suspended) {
      this.releaseStream();
      this.removeUnlockListeners?.();
      this.removeUnlockListeners = null;
      this.clearQueue();
      this.stopAudio();
      this.updateMediaSession(null);
      return;
    }

    // Re-arm the unlock for the next gesture; the element has to be
    // re-authorised because it was released above.
    this.bootstrapAudio();
  }

  /**
   * Label the OS media session with a call this player is not playing.
   *
   * In stream mode the server owns the audio, so nothing here ever calls
   * startPlayback and the lock screen would sit blank. The WebSocket still
   * delivers every call, so the caller feeds them through and iOS gets
   * talkgroup and system names on the lock screen and in Control Center.
   * The metadata can lead the audio slightly, since the stream delivers a
   * call only once the frames ahead of it have played out.
   */
  setNowPlaying(call: Call | null): void {
    this.updateMediaSession(call);
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  /** Enqueue a live (ingested) call for playback. */
  enqueue(call: Call): void {
    // Stream mode owns playback; never touch the element (see setSuspended).
    if (this.suspended) return;
    const item: QueueItem = { call };
    if (this._paused) {
      this.queue.push(item);
      this.queueChangeCb?.(this.queue.length);
      return;
    }
    if (!this.currentItem) {
      this.startPlayback(item);
    } else {
      this.queue.push(item);
      this.queueChangeCb?.(this.queue.length);
    }
  }

  /**
   * Play a call immediately from search/bookmarks.
   *
   * - If nothing is playing, just play.
   * - If an ingested (live) call is playing, push it back to the front
   *   of the queue so it resumes after this on-demand call finishes.
   * - If another on-demand call is playing, discard it (don't re-queue).
   * - Ingested calls in the queue are never touched.
   */
  playNow(call: Call): void {
    // While the server stream owns playback, hand the audio session over
    // for the duration of this one call rather than starting a second
    // element alongside it.
    if (this.suspended && !this.streamBorrowed) {
      this.streamBorrowed = true;
      streamPlayer.pause();
    }

    const item: QueueItem = { call, onDemand: true };
    if (!this.currentItem) {
      this.startPlayback(item);
      return;
    }

    if (!this.currentItem.onDemand) {
      // Currently playing an ingested call — push it back to front.
      this.queue.unshift(this.currentItem);
      this.queueChangeCb?.(this.queue.length);
    }

    this.currentItem = null;
    this._playing = false;
    this.stopAudio();
    this.startPlayback(item);
  }

  skip(): void {
    this.currentItem = null;
    this._playing = false;
    this.stopAudio();
    this.playNext();
  }

  replay(): void {
    if (this.currentItem && this.audio) {
      try {
        this.audio.currentTime = 0;
      } catch {
        // ignore — element may not be ready
      }
      void this.playElement(this.audio, this.currentItem);
      return;
    }
    // Nothing on the air: play the last Call again, the way an on-demand
    // play does, so a queued ingested Call is not thrown away for it.
    if (this.lastItem) this.playNow(this.lastItem.call);
  }

  /** True when there is something for [replay] to play. */
  canReplay(): boolean {
    return this.currentItem !== null || this.lastItem !== null;
  }

  pause(): void {
    this._paused = true;
    this.audio?.pause();
    this.ctx?.suspend().catch(() => {});
  }

  resume(): void {
    this._paused = false;
    this.ensureContext();
    this.ctx?.resume().catch(() => {});
    if (this.currentItem && this.audio && !this._playing) {
      this._playing = true;
      void this.playElement(this.audio, this.currentItem);
    } else if (!this.currentItem && this.queue.length > 0) {
      this.playNext();
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.directOutput && this.gainNode) {
      this.gainNode.gain.value = this.volume;
    } else if (this.audio) {
      // Not on the Web Audio graph — mirror to the element. iOS ignores
      // this (volume is hardware-only there); everywhere else it keeps
      // the slider working.
      this.audio.volume = this.volume;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  download(): void {
    if (!this.currentItem) return;
    const a = document.createElement("a");
    a.href = audioUrlFor(this.currentItem.call);
    a.download = downloadNameFor(this.currentItem.call);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  isPlaying(): boolean {
    return this._playing;
  }

  /** Current playback position in seconds, or 0 if not playing. */
  getPlaybackTime(): number {
    if (!this._playing || !this.audio) return 0;
    return this.audio.currentTime || 0;
  }

  setOnCallStart(cb: (call: Call) => void): void {
    this.callStartCb = cb;
  }

  setOnCallEnd(cb: () => void): void {
    this.callEndCb = cb;
  }

  setOnQueueChange(cb: (length: number) => void): void {
    this.queueChangeCb = cb;
  }

  /**
   * Register a callback invoked when an audio fetch fails. The callback
   * should attempt a silent auth refresh (e.g. POST /api/v1/auth/refresh)
   * and resolve to `true` if it succeeded — in which case the player
   * retries the current call with the new session cookie. Required
   * because <audio src=…> bypasses the RTK Query 401 retry path, so a
   * server-side token revocation (e.g. a sibling device exhausting the
   * concurrent-token cap) would otherwise leave playback broken until
   * the next scheduled refresh fires.
   */
  setAuthRecovery(fn: () => Promise<boolean>): void {
    this.authRecovery = fn;
  }

  clearQueue(): void {
    this.queue = [];
    this.queueChangeCb?.(0);
    if (this.currentItem) {
      this.currentItem = null;
      this._playing = false;
      this.stopAudio();
    }
    this.callEndCb?.();
  }

  filterQueue(predicate: (call: Call) => boolean): void {
    this.queue = this.queue.filter((item) => predicate(item.call));
    this.queueChangeCb?.(this.queue.length);
  }

  getCurrentCall(): Call | null {
    return this.currentItem?.call ?? null;
  }

  // -- Private --

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor({ latencyHint: "playback" });
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.volume;
    this.gainNode.connect(this.ctx.destination);
    this.ctx.onstatechange = () => {
      if (this.ctx?.state === "suspended" && !this._paused) {
        this.ctx.resume().catch(() => {});
      }
    };
  }

  /**
   * Lazily create the persistent HTMLAudioElement and wire it through
   * MediaElementAudioSourceNode → GainNode → destination. The element
   * and the source node are created exactly once for the lifetime of
   * the player; subsequent calls only reset the element's `src`.
   */
  private ensureAudioElement(): void {
    if (this.audio) return;

    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", this.handleEnded);
    audio.addEventListener("error", this.handleError);

    if (this.ctx && this.gainNode && !needsDirectElementOutput()) {
      try {
        const node = this.ctx.createMediaElementSource(audio);
        node.connect(this.gainNode);
      } catch {
        // Element already attached to a source, or feature unavailable —
        // fall back to direct element output.
        this.directOutput = true;
        audio.volume = this.volume;
      }
    } else {
      this.directOutput = true;
      audio.volume = this.volume;
    }

    this.audio = audio;
  }

  /**
   * Publish the current call to the OS media session.
   *
   * On iOS this is what makes the page look like a media app to the
   * system: it puts the call on the lock screen and in Control Center, and
   * it is part of what lets playback continue once Safari is backgrounded
   * or the screen is locked. Entirely cosmetic where it is unsupported, so
   * every call is guarded — the API is missing in jsdom and on older
   * WebKit, and individual actions throw when unsupported.
   */
  private updateMediaSession(call: Call | null): void {
    const session =
      typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!session) return;

    try {
      if (!call) {
        session.playbackState = "paused";
        return;
      }
      if (typeof MediaMetadata !== "undefined") {
        session.metadata = new MediaMetadata({
          // Name before label: the label is the terse radio alias
          // ("43-ME PD"), the name is the readable one ("Mentor Police"),
          // and the lock screen has room for the readable one.
          title:
            call.talkgroupName ||
            call.talkgroupLabel ||
            `Talkgroup ${call.talkgroupId}`,
          artist: call.systemLabel || "Squelch",
          album: call.talkgroupGroup || call.talkgroupTag || "",
          // Without artwork iOS shows a blank grey tile on the lock screen.
          // Two sizes so the OS can pick; both are served from the SPA root.
          artwork: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        });
      }
      session.playbackState = "playing";
    } catch {
      // Never let lock-screen metadata break playback.
    }
  }

  private bindMediaSessionActions(): void {
    const session =
      typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!session) return;

    const bind = (action: MediaSessionAction, fn: () => void) => {
      try {
        session.setActionHandler(action, fn);
      } catch {
        // Action unsupported on this platform — ignore.
      }
    };

    // In stream mode the server owns playback, so the lock-screen
    // transport has to drive the stream rather than this player.
    bind("play", () => {
      if (this.suspended) {
        streamPlayer.resume();
        return;
      }
      this.resume();
    });
    bind("pause", () => {
      if (this.suspended) {
        streamPlayer.pause();
        return;
      }
      this.pause();
    });
    bind("stop", () => {
      if (this.suspended) {
        streamPlayer.pause();
        return;
      }
      this.pause();
    });
    bind("nexttrack", () => this.skip());
    bind("previoustrack", () => this.replay());
  }

  private startPlayback(item: QueueItem): void {
    this.currentItem = item;
    this.lastItem = item;
    this.callStartCb?.(item.call);
    this.updateMediaSession(item.call);
    this.ensureContext();
    this.ensureAudioElement();
    if (!this.audio) return;

    if (this.ctx?.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    const audio = this.audio;
    // Set src and play immediately — do NOT wait for `canplay`. A hidden
    // tab can defer buffering indefinitely, so that event may never fire;
    // the item then stayed "current" forever and every later call piled up
    // in the queue until the tab was foregrounded. play() drives the load
    // itself, and asking to play is also what keeps a background tab
    // loading. Setting src already starts the fetch, so no load() call
    // (the extra load() also aborted the in-flight gesture unlock).
    audio.src = audioUrlFor(item.call);
    this._playing = true;
    void this.playElement(audio, item);
  }

  /**
   * Ask the element to play, tolerating the two rejections that are not
   * playback failures:
   *
   * - NotAllowedError — autoplay policy (no user activation yet). The item
   *   stays current and paused so the next gesture or visibility change
   *   resumes it. Skipping would silently drop the whole queue.
   * - AbortError — a newer load superseded this play(); whoever started
   *   that load owns the element now.
   */
  private playElement(audio: HTMLAudioElement, item: QueueItem): Promise<void> {
    return audio.play().catch((err: unknown) => {
      if (this.currentItem !== item) return;
      const name = (err as { name?: string } | null)?.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        this._playing = false;
        return;
      }
      this.handleError();
    });
  }

  /**
   * Kick playback when the page comes back to the foreground. Mirrors the
   * wake handling in the WebSocket clients (see ws/client.ts): a tab that
   * was backgrounded before audio ever started can have a stalled load or
   * a policy-blocked play(), and without this the queue just grows.
   */
  private handleVisibilityChange = (): void => {
    if (this.suspended) return;
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (this._paused) return;

    if (this.ctx?.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    const audio = this.audio;
    if (this.currentItem && audio) {
      // `paused` alone is not enough: a load that was deferred while
      // hidden leaves the element unpaused but with nothing buffered, so
      // it looks like it is playing while sitting at readyState 0.
      const stalled = audio.paused || audio.readyState < HAVE_FUTURE_DATA;
      if (stalled) {
        if (audio.readyState === HAVE_NOTHING) {
          try {
            audio.load();
          } catch {
            // ignore
          }
        }
        this._playing = true;
        void this.playElement(audio, this.currentItem);
      }
    } else if (!this.currentItem && this.queue.length > 0) {
      this.playNext();
    }
  }

  private stopAudio(): void {
    if (!this.audio) return;
    try {
      this.audio.pause();
    } catch {
      // ignore
    }
    this.audio.removeAttribute("src");
    try {
      this.audio.load();
    } catch {
      // ignore
    }
  }

  private handleEnded = (): void => {
    if (!this.currentItem) return;
    this.currentItem = null;
    this._playing = false;
    this.playNext();
    if (!this.currentItem) {
      this.updateMediaSession(null);
      this.releaseStream();
    }
  };

  /**
   * Give playback back to the server stream after an on-demand call. The
   * stream is re-opened rather than un-paused so it resumes at live rather
   * than minutes behind.
   */
  private releaseStream(): void {
    if (!this.streamBorrowed) return;
    this.streamBorrowed = false;
    streamPlayer.resume();
  }

  private handleError = (): void => {
    if (!this.currentItem) return;
    const item = this.currentItem;

    // First failure for this item: try a silent auth refresh in case the
    // session cookie's JWT was revoked server-side (concurrent-token cap,
    // explicit logout-elsewhere, etc.). On success, reload the same src
    // — the new Set-Cookie will be picked up automatically.
    if (!item.recoveryTried && this.authRecovery && this.audio) {
      item.recoveryTried = true;
      const recovery = this.authRecovery;
      const audio = this.audio;
      void recovery().then((ok) => {
        if (!ok || this.currentItem !== item || this.audio !== audio) {
          this.skipCurrent(item);
          return;
        }
        try {
          audio.load();
        } catch {
          // ignore
        }
        audio.play().catch(() => this.skipCurrent(item));
      });
      return;
    }

    this.skipCurrent(item);
  };

  private skipCurrent(item: QueueItem): void {
    if (this.currentItem !== item) return;
    console.warn("[audioPlayer] failed to play call", item.call.id);
    this.currentItem = null;
    this._playing = false;
    this.playNext();
  }

  private playNext(): void {
    const next = this.queue.shift();
    this.queueChangeCb?.(this.queue.length);
    if (next) {
      this.startPlayback(next);
    } else {
      this.currentItem = null;
      this._playing = false;
      this.callEndCb?.();
    }
  }
}

export const audioPlayer = new AudioPlayer();
