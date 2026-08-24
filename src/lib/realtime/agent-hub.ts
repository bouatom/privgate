import "server-only";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { verifyDeviceRequest } from "../device-auth";
import { registerDeviceSocket, publishConsole, dropClientStatus } from "./bus";
import { handleAgentRpc, type AgentRpc } from "./rpc";
import { expectedAgentOrigin, validateAgentOrigin } from "../agent-origin";
import { getDb, appendAudit } from "../db";
import { touchDeviceLastSeen } from "../db/devices";
import { drainQueuedUpdateOnReconnect } from "../agent-update";
import { registerShutdownHook } from "../lifecycle/shutdown";

const WS_PATH = "/api/agent/ws";
const patched = globalThis as unknown as { __privgateWsPatched?: boolean };
const wss = new WebSocketServer({ noServer: true });
// Live agent sockets so shutdown can send a proper close frame (1001) instead
// of letting SIGTERM drop the TCP connection mid-flight.
const openSockets = new Set<WebSocket>();

/**
 * bus.registerDeviceSocket wrapped with device bookkeeping: stamps last_seen_at
 * on connect and on socket close, and serves any update that was queued while
 * the device was offline (the socket is registered first, so pushes land).
 */
export function registerTrackedDeviceSocket(
  deviceId: string,
  socket: { send: (data: string) => void; ready: () => boolean },
): () => void {
  const db = getDb();
  touchDeviceLastSeen(db, deviceId);
  const unregister = registerDeviceSocket(deviceId, socket);
  drainQueuedUpdateOnReconnect(db, deviceId);
  return () => {
    unregister();
    touchDeviceLastSeen(getDb(), deviceId);
  };
}

function pathnameOf(url: string | undefined): string {
  try {
    return decodeURIComponent(String(url || "/").split("?")[0]);
  } catch {
    return "/";
  }
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function attachAgentWebSocket() {
  if (patched.__privgateWsPatched) return;
  patched.__privgateWsPatched = true;
  registerShutdownHook("agent-websockets", () => {
    for (const ws of openSockets) {
      try {
        ws.close(1001, "server restarting");
      } catch {
        // socket already closing
      }
    }
  });
  const orig = http.Server.prototype.emit;
  http.Server.prototype.emit = function patchedEmit(event: string, ...args: unknown[]) {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      const socket = args[1] as Duplex;
      const head = args[2] as Buffer;
      if (pathnameOf(req.url) === WS_PATH) {
        wss.handleUpgrade(req, socket, head, (ws) => accept(req, ws));
        return true;
      }
    }
    return orig.apply(this, [event, ...args] as unknown as Parameters<typeof orig>);
  };
}

function accept(req: IncomingMessage, ws: WebSocket) {
  const auth = verifyDeviceRequest({
    deviceId: header(req, "x-device-id"),
    timestamp: header(req, "x-timestamp"),
    signature: header(req, "x-signature"),
    method: "GET",
    path: WS_PATH,
    rawBody: "",
  });
  if (!auth.ok) {
    ws.close(4401, auth.error);
    return;
  }

  // Validate origin BEFORE accepting connection
  const requestOrigin = header(req, "origin");
  if (!validateAgentOrigin(requestOrigin || "", process.env)) {
    const db = getDb();
    console.error(`PrivGate WebSocket rejected: origin mismatch (got ${requestOrigin})`);
    appendAudit(db, `device:${auth.deviceId}`, "agent.ws.origin-rejected", auth.deviceId, {
      origin: requestOrigin,
      expected: expectedAgentOrigin(process.env),
    });
    ws.close(1008, "origin mismatch");
    return;
  }

  openSockets.add(ws);
  const forgetSocket = () => openSockets.delete(ws);
  ws.on("close", forgetSocket);
  ws.on("error", forgetSocket);

  const unregister = registerTrackedDeviceSocket(auth.deviceId, {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    ready: () => ws.readyState === WebSocket.OPEN,
  });
  publishConsole("devices");
  ws.on("message", (raw) => {
    let parsed: AgentRpc;
    try {
      parsed = JSON.parse(String(raw)) as AgentRpc;
    } catch {
      ws.send(JSON.stringify({ type: "result", ok: false, error: "invalid JSON" }));
      return;
    }
    const reply = handleAgentRpc(auth.deviceId, parsed);
    ws.send(JSON.stringify(reply));
  });
  ws.on("close", () => {
    unregister();
    dropClientStatus(auth.deviceId);
    publishConsole("devices");
  });
}
