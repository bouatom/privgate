import "server-only";
import { getDb, grantIdentities, type ElevationRequest, type JitGrant } from "../db";
import { publishConsole, publishDevice, connectedDeviceIds } from "./bus";

export function notifyPendingRequest(request: ElevationRequest) {
  publishConsole("requests");
  publishConsole("devices");
  // filePath names the program in the agent's tray notice ("Waiting for
  // approval: …") instead of a generic "a program".
  publishDevice(request.deviceId, {
    type: "request-pending",
    requestId: request.id,
    filePath: request.filePath,
    arguments: request.arguments ?? "",
  });
}

export function notifyRequestApproved(request: ElevationRequest, ticket: string) {
  publishConsole("requests");
  publishConsole("devices");
  publishDevice(request.deviceId, {
    type: "ticket",
    requestId: request.id,
    ticket,
    decision: "allow",
  });
}

export function notifyRequestDenied(request: ElevationRequest) {
  publishConsole("requests");
  publishConsole("devices");
  publishDevice(request.deviceId, { type: "request-denied", requestId: request.id });
}

/**
 * One jit-grant per covered identity: personal grants push a single message,
 * group grants fan out over the grant-time membership snapshot so every member
 * gets their own signed ticket addressed to their own SID.
 */
export function notifyJitGrant(grant: JitGrant, tickets: Array<{ userSid: string; ticket: string }>) {
  publishConsole("jit");
  publishConsole("devices");
  const exp = Math.floor(new Date(grant.expiresAt).getTime() / 1000);
  for (const entry of tickets) {
    publishDevice(grant.deviceId, {
      type: "jit-grant",
      grantId: grant.id,
      ticket: entry.ticket,
      userSid: entry.userSid,
      exp,
    });
  }
}

export function notifyJitRevoke(grant: JitGrant) {
  publishConsole("jit");
  publishConsole("devices");
  const sids = grantIdentities(getDb(), grant)
    .map((identity) => identity.adSid)
    .filter((sid) => sid !== "");
  const targets = sids.length > 0 ? sids : [""];
  for (const userSid of targets) {
    publishDevice(grant.deviceId, {
      type: "jit-revoke",
      grantId: grant.id,
      userSid,
    });
  }
}

export function notifyDeviceChange() {
  publishConsole("devices");
}

export function notifyUacMode(mode: string) {
  publishConsole("devices");
  for (const deviceId of connectedDeviceIds()) {
    publishDevice(deviceId, { type: "uac-mode", mode });
  }
}
