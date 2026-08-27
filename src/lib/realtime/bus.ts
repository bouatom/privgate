import "server-only";

export type ConsoleTopic = "requests" | "devices" | "jit" | "audit" | "updates";

export type ConsoleEvent = {
  type: "mutate";
  topic: ConsoleTopic;
};

type DeviceSocket = {
  send: (data: string) => void;
  ready: () => boolean;
};

/** Latest interactive-GUI heartbeat reported by a device's tray. */
export type UiBeat = { atMs: number; uptimeSec: number; pid: number };

type Hub = {
  sockets: Map<string, Set<DeviceSocket>>;
  console: Set<(event: ConsoleEvent) => void>;
  ui: Map<string, UiBeat>;
  /** Bounded per-topic replay buffer so short SSE drops can be caught up. */
  replay: Map<ConsoleTopic, ConsoleEvent[]>;
};

const root = globalThis as unknown as { __privgateRealtime?: Hub };

function hub(): Hub {
  root.__privgateRealtime ??= {
    sockets: new Map(),
    console: new Set(),
    ui: new Map(),
    replay: new Map(),
  };
  return root.__privgateRealtime;
}

/** A beat older than this is pruned outright (device went silent for good). */
const UI_TTL_MS = 10 * 60_000;
/** Freshness a beat must have (plus a live socket) for uiAlive. */
const UI_ALIVE_MS = 5 * 60_000;
/** Max per-topic events retained for SSE replay (memory-bounded, Low/Med). */
const REPLAY_CAP = 50;

export function registerDeviceSocket(deviceId: string, socket: DeviceSocket): () => void {
  const sockets = hub().sockets;
  let set = sockets.get(deviceId);
  if (!set) {
    set = new Set();
    sockets.set(deviceId, set);
  }
  set.add(socket);
  return () => {
    set!.delete(socket);
    if (set!.size === 0) sockets.delete(deviceId);
  };
}

export function publishDevice(deviceId: string, payload: unknown): number {
  const set = hub().sockets.get(deviceId);
  if (!set) return 0;
  const data = JSON.stringify(payload);
  let n = 0;
  for (const socket of set) {
    if (!socket.ready()) continue;
    socket.send(data);
    n += 1;
  }
  return n;
}

export function connectedDeviceIds(): string[] {
  const ids: string[] = [];
  for (const [id, set] of hub().sockets) {
    if ([...set].some((s) => s.ready())) ids.push(id);
  }
  return ids;
}

export function deviceIsConnected(deviceId: string): boolean {
  const set = hub().sockets.get(deviceId);
  return Boolean(set && [...set].some((s) => s.ready()));
}

export function subscribeConsole(listener: (event: ConsoleEvent) => void): () => void {
  hub().console.add(listener);
  return () => {
    hub().console.delete(listener);
  };
}

export function publishConsole(topic: ConsoleTopic) {
  const h = hub();
  const event: ConsoleEvent = { type: "mutate", topic };
  // Buffer for replay: a client that reconnects after a gap will be caught up.
  const buf = h.replay.get(topic) ?? [];
  buf.push(event);
  if (buf.length > REPLAY_CAP) buf.splice(0, buf.length - REPLAY_CAP);
  h.replay.set(topic, buf);
  for (const listener of h.console) listener(event);
}

/**
 * Replay any buffered console events for a topic to a freshly-connected SSE
 * subscriber. Simple, memory-bounded (vs REPLAY_CAP per topic), and best-effort:
 * it cures the common "missed an update during a brief disconnect" case without
 * attempting durable/at-least-once delivery. Events older than the cap are gone.
 */
export function replayConsole(topic: ConsoleTopic, deliver: (event: ConsoleEvent) => void): void {
  const buf = hub().replay.get(topic);
  if (!buf) return;
  for (const event of buf) deliver(event);
}

/** Record the newest GUI heartbeat for a device (in-memory only, tiny payload). */
export function noteClientStatus(deviceId: string, uptimeSec: number, pid: number): void {
  const ui = hub().ui;
  pruneUi(ui, Date.now());
  ui.set(deviceId, { atMs: Date.now(), uptimeSec, pid });
}

/** Called when a device socket closes so stale beats cannot outlive it. */
export function dropClientStatus(deviceId: string): void {
  hub().ui.delete(deviceId);
}

/** Newest GUI beat for a device, or null when it never sent one. */
export function latestClientStatus(deviceId: string, nowMs: number = Date.now()): UiBeat | null {
  const ui = hub().ui;
  pruneUi(ui, nowMs);
  return ui.get(deviceId) ?? null;
}

/**
 * Console-facing liveness: alive only while the device socket is connected AND
 * a GUI heartbeat arrived within the freshness window. The service alone proves
 * nothing about the user session — this is what answers "is the tray running?".
 */
export function uiStatusFor(
  deviceId: string,
  connected: boolean,
  nowMs: number = Date.now(),
): { uiAlive: boolean; uiLastSeenAt: string | null } {
  const beat = latestClientStatus(deviceId, nowMs);
  if (!beat) return { uiAlive: false, uiLastSeenAt: null };
  return {
    uiAlive: connected && nowMs - beat.atMs <= UI_ALIVE_MS,
    uiLastSeenAt: new Date(beat.atMs).toISOString(),
  };
}

function pruneUi(ui: Map<string, UiBeat>, nowMs: number): void {
  for (const [id, beat] of ui) {
    if (nowMs - beat.atMs > UI_TTL_MS) ui.delete(id);
  }
}

export function resetRealtimeForTests() {
  const h = hub();
  h.sockets.clear();
  h.console.clear();
  h.ui.clear();
  h.replay.clear();
}
