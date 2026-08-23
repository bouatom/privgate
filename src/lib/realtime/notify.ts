import "server-only";
import { getDb, getUser, type ElevationRequest, type JitGrant } from "../db";
import { publishConsole, publishDevice } from "./bus";

export function notifyPendingRequest(request: ElevationRequest) {
  publishConsole("requests");
  publishConsole("devices");
  publishDevice(request.deviceId, { type: "request-pending", requestId: request.id });
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

export function notifyJitGrant(grant: JitGrant, ticket: string) {
  const user = getUser(getDb(), grant.userId);
  publishConsole("jit");
  publishConsole("devices");
  publishDevice(grant.deviceId, {
    type: "jit-grant",
    grantId: grant.id,
    ticket,
    userSid: user?.adSid || "",
    exp: Math.floor(new Date(grant.expiresAt).getTime() / 1000),
  });
}

export function notifyJitRevoke(grant: JitGrant) {
  const user = getUser(getDb(), grant.userId);
  publishConsole("jit");
  publishConsole("devices");
  publishDevice(grant.deviceId, {
    type: "jit-revoke",
    grantId: grant.id,
    userSid: user?.adSid || "",
  });
}

export function notifyDeviceChange() {
  publishConsole("devices");
}
