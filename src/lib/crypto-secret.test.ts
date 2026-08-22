import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto-secret";

const key = "operator-supplied-master-key-value-long-enough";

/** Reproduces the pre-HKDF keying so we can prove old records still decrypt. */
function legacyEncrypt(plain: string, master: string): string {
  const iv = randomBytes(12);
  const keyBytes = Buffer.from(master.padEnd(32, "0").slice(0, 32), "utf8");
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

describe("crypto-secret", () => {
  it("round-trips a secret", () => {
    const packed = encryptSecret("device-secret", key);
    expect(packed).not.toContain("device-secret");
    expect(decryptSecret(packed, key)).toBe("device-secret");
  });

  it("uses a fresh IV per call", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("derives a full 32-byte key so short master keys are not zero-padded", () => {
    const packed = encryptSecret("secret", "short");
    expect(decryptSecret(packed, "short")).toBe("secret");
    expect(() => decryptSecret(packed, "short000000000000000000000000000")).toThrow();
  });

  it("rejects the wrong key", () => {
    const packed = encryptSecret("secret", key);
    expect(() => decryptSecret(packed, "another-master-key-entirely-here")).toThrow();
  });

  it("rejects a tampered ciphertext", () => {
    const buf = Buffer.from(encryptSecret("secret", key), "base64url");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptSecret(buf.toString("base64url"), key)).toThrow();
  });

  it("still reads records written before HKDF derivation", () => {
    expect(decryptSecret(legacyEncrypt("old-device-secret", key), key)).toBe("old-device-secret");
  });
});
