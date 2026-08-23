import "server-only";
import { hkdfSync } from "node:crypto";
import { deviceSecretKey } from "./secrets";
import { safeEqual } from "./signing";

const SALT = "privgate.enrollment.v1";

/** Shared token baked into every client MSI/script for this console. */
export function enrollmentToken(env: Record<string, string | undefined> = process.env): string {
  const derived = hkdfSync("sha256", Buffer.from(deviceSecretKey(env), "utf8"), SALT, "client-install", 32);
  return Buffer.from(derived).toString("base64url");
}

export function verifyEnrollmentToken(
  raw: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const token = (raw || "").trim();
  if (!token) return false;
  return safeEqual(token, enrollmentToken(env));
}

export function normalizeHostname(raw: string): string | null {
  const hostname = raw.trim();
  if (!hostname || hostname.length > 253) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(hostname)) return null;
  return hostname;
}

export function normalizeJoinType(raw: string | undefined): string {
  const value = (raw || "").trim().toLowerCase();
  if (value === "hybrid" || value === "entra" || value === "ad") return value;
  return "unknown";
}
