import { createHash } from "node:crypto";
import { hmacDevice, safeEqual } from "./signing";
import { decryptSecret } from "./crypto-secret";
import { getDb, getDevice } from "./db";
import { bodySha256 } from "./evaluate";

const skewMs = 5 * 60 * 1000;

export function verifyDeviceRequest(args: {
  deviceId: string | null;
  timestamp: string | null;
  signature: string | null;
  method: string;
  path: string;
  rawBody: string;
}): { ok: true; deviceId: string } | { ok: false; status: number; error: string } {
  if (!args.deviceId || !args.timestamp || !args.signature) {
    return { ok: false, status: 401, error: "missing device credentials" };
  }
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > skewMs) {
    return { ok: false, status: 401, error: "timestamp skew" };
  }
  const db = getDb();
  const device = getDevice(db, args.deviceId);
  if (!device) return { ok: false, status: 401, error: "unknown device" };
  const key = process.env.DEVICE_SECRET_KEY || "dev-device-secret-key-32bytes!!";
  let secret: string;
  try {
    secret = decryptSecret(device.secretEnc, key);
  } catch {
    return { ok: false, status: 401, error: "device secret unreadable" };
  }
  const expected = hmacDevice(
    secret,
    args.timestamp,
    args.method,
    args.path,
    bodySha256(args.rawBody),
  );
  if (!safeEqual(expected, args.signature)) {
    return { ok: false, status: 401, error: "bad device signature" };
  }
  return { ok: true, deviceId: args.deviceId };
}

export function hashHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
