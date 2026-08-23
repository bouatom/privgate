import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 10;

export function assertPassword(plain: string | undefined): string | undefined {
  const value = (plain || "").trim();
  if (!value) return "password required for local users";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 32);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(plain: string, packed: string): boolean {
  const parts = packed.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64url");
  const expected = Buffer.from(parts[2]!, "base64url");
  const actual = scryptSync(plain, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
