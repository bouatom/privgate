import "server-only";

export type ConsoleTopic = "requests" | "devices" | "jit" | "audit";

export type ConsoleEvent = {
  type: "mutate";
  topic: ConsoleTopic;
};

type DeviceSocket = {
  send: (data: string) => void;
  ready: () => boolean;
};

type Hub = {
  sockets: Map<string, Set<DeviceSocket>>;
  console: Set<(event: ConsoleEvent) => void>;
};

const root = globalThis as unknown as { __privgateRealtime?: Hub };

function hub(): Hub {
  root.__privgateRealtime ??= {
    sockets: new Map(),
    console: new Set(),
  };
  return root.__privgateRealtime;
}

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
  const event: ConsoleEvent = { type: "mutate", topic };
  for (const listener of hub().console) listener(event);
}

export function resetRealtimeForTests() {
  hub().sockets.clear();
  hub().console.clear();
}
