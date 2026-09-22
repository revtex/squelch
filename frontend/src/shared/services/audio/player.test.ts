import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Call } from "@/features/scanner";

// A stub media element that records play() calls and never fires `canplay`
// on its own — the state a hidden tab leaves the element in when the
// browser defers buffering.
class FakeAudio {
  static instances: FakeAudio[] = [];

  preload = "";
  private srcValue = "";
  volume = 1;
  currentTime = 0;
  paused = true;
  readyState = 0;
  playCalls = 0;
  loadCalls = 0;
  /** Set to an error name to make the next play() reject with it. */
  rejectPlayWith: string | null = null;
  /** Applied to the next instance created — the player owns construction. */
  static rejectFirstPlayWith: string | null = null;

  private listeners = new Map<string, Set<() => void>>();
  /** Resolvers for play() calls made while the element had no source. */
  private pendingPlays: Array<() => void> = [];

  get src(): string {
    return this.srcValue;
  }

  /**
   * Assigning a source settles any play() that was left pending on the
   * source-less element, which is what real browsers do.
   */
  set src(value: string) {
    this.srcValue = value;
    if (!value) return;
    const pending = this.pendingPlays;
    this.pendingPlays = [];
    for (const resolve of pending) resolve();
  }

  constructor() {
    FakeAudio.instances.push(this);
    if (FakeAudio.rejectFirstPlayWith) {
      this.rejectPlayWith = FakeAudio.rejectFirstPlayWith;
      FakeAudio.rejectFirstPlayWith = null;
    }
  }

  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  play(): Promise<void> {
    this.playCalls += 1;
    if (this.rejectPlayWith) {
      const err = new Error("blocked");
      err.name = this.rejectPlayWith;
      this.rejectPlayWith = null;
      return Promise.reject(err);
    }
    this.paused = false;
    if (!this.srcValue) {
      // No source: the promise cannot settle yet. Real browsers keep it
      // pending rather than rejecting.
      return new Promise<void>((resolve) => {
        this.pendingPlays.push(resolve);
      });
    }
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {
    this.loadCalls += 1;
  }

  removeAttribute(): void {
    this.srcValue = "";
  }
}

class FakeAudioContext {
  state = "running";
  onstatechange: (() => void) | null = null;
  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }
  static mediaSourceCalls = 0;
  createMediaElementSource() {
    FakeAudioContext.mediaSourceCalls += 1;
    return { connect: () => {} };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function makeCall(id: number): Call {
  return {
    id,
    audioName: `call-${id}.m4a`,
    audioType: "audio/mp4",
    dateTime: Math.floor(Date.now() / 1000),
    systemId: 100,
    system: 1,
    talkgroupId: 27501,
    talkgroup: 162,
    duration: 3000,
  };
}

/** Most recently constructed stub element. */
function lastElement(): FakeAudio {
  const el = FakeAudio.instances[FakeAudio.instances.length - 1];
  if (!el) throw new Error("no audio element was created");
  return el;
}

/** Fresh module instance per test — the player is a module singleton. */
async function loadPlayer() {
  vi.resetModules();
  const mod = await import("./player");
  return mod.audioPlayer;
}

interface FakeArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

class FakeMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: FakeArtwork[];
  constructor(init: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: FakeArtwork[];
  }) {
    this.title = init.title ?? "";
    this.artist = init.artist ?? "";
    this.album = init.album ?? "";
    this.artwork = init.artwork ?? [];
  }
}

interface FakeMediaSession {
  metadata: FakeMediaMetadata | null;
  playbackState: string;
  handlers: Map<string, () => void>;
  setActionHandler(action: string, fn: () => void): void;
}

function stubMediaSession(): FakeMediaSession {
  const session: FakeMediaSession = {
    metadata: null,
    playbackState: "none",
    handlers: new Map(),
    setActionHandler(action, fn) {
      session.handlers.set(action, fn);
    },
  };
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    get: () => session,
  });
  vi.stubGlobal("MediaMetadata", FakeMediaMetadata);
  return session;
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("audioPlayer", () => {
  const realUA = navigator.userAgent;

  beforeEach(() => {
    FakeAudio.instances = [];
    FakeAudioContext.mediaSourceCalls = 0;
    setUserAgent(realUA);
    FakeAudio.rejectFirstPlayWith = null;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaSession");
  });

  it("does not pause a live call when the gesture unlock finally settles", async () => {
    const player = await loadPlayer();

    // A gesture before any call: the unlock plays the still-source-less
    // element, and that play() cannot settle yet.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await Promise.resolve();

    // Now a live call arrives and takes the same element. Assigning a source
    // is what settles the unlock's play() — and its `.then` used to pause
    // the call that had just started, stalling the queue for good because
    // `ended` never fires on a paused element.
    player.enqueue(makeCall(1));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const el = lastElement();
    expect(el.src).toContain("/api/v1/calls/1/audio");
    expect(el.paused).toBe(false);
  });

  it("replays the last Call once it has finished", async () => {
    // Replay is reached for after a Call has played out, which is exactly
    // when the player has no current item left — it used to do nothing.
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    lastElement().emit("ended");
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(player.canReplay()).toBe(true);
    player.replay();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(lastElement().src).toContain("/api/v1/calls/1/audio");
    expect(player.isPlaying()).toBe(true);
  });

  it("has nothing to replay before the first Call", async () => {
    const player = await loadPlayer();
    expect(player.canReplay()).toBe(false);
    player.replay();
    expect(player.isPlaying()).toBe(false);
  });

  it("plays without waiting for canplay", async () => {
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    await Promise.resolve();

    const el = lastElement();
    expect(el.src).toContain("/api/v1/calls/1/audio");
    // Regression: playback used to be gated on a `canplay` listener, which
    // a background tab may never fire — leaving the queue to pile up.
    expect(el.playCalls).toBe(1);
  });

  it("keeps the call queued when autoplay policy blocks play()", async () => {
    const player = await loadPlayer();
    FakeAudio.rejectFirstPlayWith = "NotAllowedError";

    player.enqueue(makeCall(1));
    player.enqueue(makeCall(2));
    await Promise.resolve();
    await Promise.resolve();

    // The blocked call must stay current rather than be skipped, or a
    // policy rejection would silently drain the whole queue.
    expect(player.getCurrentCall()?.id).toBe(1);
    expect(player.isPlaying()).toBe(false);

    // …and the foreground kick recovers it.
    const el = lastElement();
    el.paused = true;
    setVisibility("visible");
    await Promise.resolve();
    expect(el.playCalls).toBeGreaterThan(1);
  });

  it("resumes a stalled call when the page becomes visible", async () => {
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    await Promise.resolve();

    const el = lastElement();
    // Emulate a hidden-tab stall: play() was called, so the element is not
    // paused, but nothing ever buffered.
    el.paused = false;
    el.readyState = 0;
    const before = el.playCalls;

    setVisibility("visible");
    await Promise.resolve();

    expect(el.playCalls).toBeGreaterThan(before);
    expect(el.loadCalls).toBeGreaterThan(0);
    setVisibility("visible");
  });

  it("does not re-issue play() for healthy playback on visibility change", async () => {
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    await Promise.resolve();

    const el = lastElement();
    el.paused = false;
    el.readyState = 4;
    const before = el.playCalls;

    setVisibility("visible");
    await Promise.resolve();

    expect(el.playCalls).toBe(before);
  });

  it("unlocks the audio element synchronously inside the gesture", async () => {
    await loadPlayer();

    // No await between the gesture and the assertion: WebKit drops transient
    // user activation across an await, so an unlock that only runs in a later
    // microtask never counts as gesture-initiated on iOS and playback stays
    // blocked for the whole session.
    document.body.dispatchEvent(new Event("touchstart"));

    expect(lastElement().playCalls).toBe(1);
  });

  it("keeps call audio off the Web Audio graph on iOS", async () => {
    setUserAgent(IPHONE_UA);
    const player = await loadPlayer();

    player.enqueue(makeCall(1));
    await Promise.resolve();

    // iOS mutes Web Audio output with the hardware ring/silent switch but
    // not media-element output, so routing the element through a
    // MediaElementAudioSourceNode makes every call silent on a phone set
    // to silent.
    expect(FakeAudioContext.mediaSourceCalls).toBe(0);

    // Volume falls back to the element (iOS ignores it, but nothing else
    // should regress).
    player.setVolume(0.5);
    expect(lastElement().volume).toBe(0.5);
  });

  it("routes through the Web Audio graph elsewhere", async () => {
    const player = await loadPlayer();

    player.enqueue(makeCall(1));
    await Promise.resolve();

    expect(FakeAudioContext.mediaSourceCalls).toBe(1);
  });

  it("publishes the playing call to the OS media session", async () => {
    // Bound in the constructor, so the stub has to exist before the module
    // is instantiated.
    const session = stubMediaSession();
    const player = await loadPlayer();

    player.enqueue({
      ...makeCall(1),
      talkgroupLabel: "Fire Dispatch",
      systemLabel: "MARCS",
    });
    await Promise.resolve();

    // iOS uses this to show the call on the lock screen and to treat the
    // page as a media app, which is part of what keeps audio alive once
    // Safari is backgrounded.
    expect(session.metadata?.title).toBe("Fire Dispatch");
    expect(session.metadata?.artist).toBe("MARCS");
    // Without artwork iOS renders a blank grey tile on the lock screen.
    expect(session.metadata?.artwork?.length).toBeGreaterThan(0);
    expect(session.playbackState).toBe("playing");
    expect(session.handlers.has("play")).toBe(true);
    expect(session.handlers.has("pause")).toBe(true);
  });

  it("prefers the talkgroup name over the terse label on the lock screen", async () => {
    const session = stubMediaSession();
    const player = await loadPlayer();

    player.enqueue({
      ...makeCall(1),
      talkgroupLabel: "43-ME PD",
      talkgroupName: "Mentor Police",
      systemLabel: "MARCS",
    });
    await Promise.resolve();

    // The label is the radio alias; the name is the readable one, and the
    // lock screen has room for it.
    expect(session.metadata?.title).toBe("Mentor Police");
  });

  it("falls back to the label when a talkgroup has no name", async () => {
    const session = stubMediaSession();
    const player = await loadPlayer();

    player.enqueue({
      ...makeCall(1),
      talkgroupLabel: "43-ME PD",
      systemLabel: "MARCS",
    });
    await Promise.resolve();

    expect(session.metadata?.title).toBe("43-ME PD");
  });

  it("works when the media session API is absent", async () => {
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    await Promise.resolve();

    // jsdom and older WebKit have no navigator.mediaSession; playback must
    // not depend on it.
    expect(player.getCurrentCall()?.id).toBe(1);
  });

  it("touches nothing while suspended for the server stream", async () => {
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    await Promise.resolve();
    const before = FakeAudio.instances.length;

    player.setSuspended(true);
    expect(player.isSuspended()).toBe(true);
    expect(player.getCurrentCall()).toBeNull();

    // iOS lets one element hold the audio session. A suspended player must
    // not enqueue, and its gesture unlock must stop re-playing its element
    // on every tap — either would steal the session from the stream.
    const el = lastElement();
    const playsBefore = el.playCalls;
    player.enqueue(makeCall(2));
    document.body.dispatchEvent(new Event("touchstart"));
    setVisibility("visible");
    await Promise.resolve();

    expect(player.getCurrentCall()).toBeNull();
    expect(el.playCalls).toBe(playsBefore);
    expect(FakeAudio.instances.length).toBe(before);
  });

  it("resumes normal playback when the stream is switched off", async () => {
    const player = await loadPlayer();
    player.setSuspended(true);
    player.setSuspended(false);

    expect(player.isSuspended()).toBe(false);
    player.enqueue(makeCall(9));
    await Promise.resolve();
    expect(player.getCurrentCall()?.id).toBe(9);
  });

  it("labels the media session for calls it is not playing", async () => {
    const session = stubMediaSession();
    const player = await loadPlayer();

    // Stream mode: the server plays the audio, so nothing here starts
    // playback and the lock screen would otherwise stay blank.
    player.setSuspended(true);
    player.setNowPlaying({
      ...makeCall(3),
      talkgroupLabel: "EMS North",
      systemLabel: "MARCS",
    });

    expect(session.metadata?.title).toBe("EMS North");
    expect(session.metadata?.artwork?.length).toBeGreaterThan(0);
    expect(player.getCurrentCall()).toBeNull();
  });

  it("advances the queue on ended", async () => {
    const player = await loadPlayer();
    player.enqueue(makeCall(1));
    player.enqueue(makeCall(2));
    await Promise.resolve();

    const el = lastElement();
    expect(player.getCurrentCall()?.id).toBe(1);
    el.emit("ended");
    await Promise.resolve();
    expect(player.getCurrentCall()?.id).toBe(2);
  });

  it("hands the audio session to an on-demand call and back to the stream", async () => {
    // loadPlayer resets the module registry, so the stream player must be
    // imported after it or the spies land on a different instance than the
    // one player.ts holds.
    const player = await loadPlayer();
    const mod = await import("./streamPlayer");
    const pause = vi.spyOn(mod.streamPlayer, "pause");
    const resume = vi.spyOn(mod.streamPlayer, "resume");

    player.setSuspended(true);

    // Playing from search or bookmarks while streaming: on iOS only one
    // element may hold the audio session, so the two must take turns
    // rather than compete.
    player.playNow(makeCall(1));
    await Promise.resolve();
    expect(pause).toHaveBeenCalled();

    lastElement().emit("ended");
    await Promise.resolve();
    expect(resume).toHaveBeenCalled();

    pause.mockRestore();
    resume.mockRestore();
  });
});
