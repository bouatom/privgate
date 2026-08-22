import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const HKDF_SALT = "privgate.crypto-secret.v1";
const HKDF_INFO = "privgate device secret encryption";

const derivedKeys = new Map<string, Buffer>();

function keyBytes(secret: string): Buffer {
  const cached = derivedKeys.get(secret);
  if (cached) return cached;
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), HKDF_SALT, HKDF_INFO, 32));
  derivedKeys.set(secret, key);
  return key;
}

/**
 * Pre-HKDF keying: the master secret padded or truncated to 32 UTF-8 bytes. Only
 * used to read records written before the KDF change, never to write new ones.
 */
function legacyKeyBytes(secret: string): Buffer {
  return Buffer.from(secret.padEnd(32, "0").slice(0, 32), "utf8");
}

export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function open(packed: Buffer, keyMaterial: Buffer): string {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const data = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function decryptSecret(packed: string, key: string): string {
  const buf = Buffer.from(packed, "base64url");
  try {
    return open(buf, keyBytes(key));
  } catch {
    // GCM authentication failed: the record may predate HKDF derivation.
    return open(buf, legacyKeyBytes(key));
  }
}
