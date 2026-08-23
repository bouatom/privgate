import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decideRequest, listPolicies, resetDbForTests } from "./db";
import { approvedTicket } from "./evaluate";
import {
  deviceIsConnected,
  publishConsole,
  publishDevice,
  registerDeviceSocket,
  resetRealtimeForTests,
  subscribeConsole,
} from "./realtime/bus";
import { notifyRequestApproved } from "./realtime/notify";
import { handleAgentRpc } from "./realtime/rpc";

const staffSid = "S-1-5-21-1000-1000-1000-1101";

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("realtime bus", () => {
  it("delivers device payloads only while the socket is registered", () => {
    const sent: unknown[] = [];
    const stop = registerDeviceSocket("dev-lab-01", {
      send: (data) => sent.push(JSON.parse(data)),
      ready: () => true,
    });
    expect(deviceIsConnected("dev-lab-01")).toBe(true);
    expect(publishDevice("dev-lab-01", { type: "ping" })).toBe(1);
    stop();
    expect(deviceIsConnected("dev-lab-01")).toBe(false);
    expect(publishDevice("dev-lab-01", { type: "ping" })).toBe(0);
    expect(sent).toEqual([{ type: "ping" }]);
  });

  it("notifies console subscribers of mutations", () => {
    const topics: string[] = [];
    const stop = subscribeConsole((event) => topics.push(event.topic));
    publishConsole("requests");
    stop();
    publishConsole("jit");
    expect(topics).toEqual(["requests"]);
  });
});

describe("agent realtime RPC", () => {
  it("allowlists over the socket protocol", () => {
    const db = resetDbForTests(":memory:");
    const widget = listPolicies(db)[0]!;
    const reply = handleAgentRpc("dev-lab-01", {
      id: "1",
      type: "evaluate",
      body: {
        userSid: staffSid,
        filePath: "C:\\\\install\\\\WidgetSetup.msi",
        fileHash: widget.fileHash,
        publisher: widget.publisher,
      },
    });
    expect(reply).toMatchObject({ id: "1", type: "result", ok: true });
    expect((reply.payload as { decision: string }).decision).toBe("allow");
    expect((reply.payload as { ticket?: string }).ticket).toBeTruthy();
  });

  it("pushes an approved ticket to the waiting device", () => {
    const db = resetDbForTests(":memory:");
    const sent: string[] = [];
    registerDeviceSocket("dev-lab-01", {
      send: (data) => sent.push(data),
      ready: () => true,
    });
    const hash = createHash("sha256").update("rare-live").digest("hex");
    const reply = handleAgentRpc("dev-lab-01", {
      id: "2",
      type: "evaluate",
      body: {
        userSid: staffSid,
        filePath: "C:\\\\Tools\\\\Rare.exe",
        fileHash: hash,
        publisher: "CN=Rare",
      },
    });
    const payload = reply.payload as { decision: string; requestId: string };
    expect(payload.decision).toBe("pending");
    expect(sent.some((row) => row.includes("request-pending"))).toBe(true);
    const decided = decideRequest(db, payload.requestId, "approved", "ada@contoso.test");
    const ticket = approvedTicket(db, payload.requestId);
    expect(ticket).toBeTruthy();
    notifyRequestApproved(decided!, ticket!);
    expect(sent.some((row) => row.includes(ticket!))).toBe(true);
  });
});
