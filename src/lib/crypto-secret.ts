import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(secret: string): Buffer {
  return Buffer.from(secret.padEnd(32, "0").slice(0, 32), "utf8");
}

export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(packed: string, key: string): string {
  const buf = Buffer.from(packed, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
