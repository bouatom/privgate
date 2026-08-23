import { describe, it, expect } from "vitest";
import {
  generateSigningKeyPair,
  signData,
  verifySignature,
  publicKeyFingerprint,
} from "./signing-keys";

describe("signing-keys", () => {
  it("generates valid Ed25519 key pair", () => {
    const keyPair = generateSigningKeyPair();
    expect(keyPair.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(keyPair.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
  });

  it("signs and verifies data", () => {
    const keyPair = generateSigningKeyPair();
    const data = "test message";
    const signature = signData(data, keyPair.privateKey);
    const isValid = verifySignature(data, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });

  it("rejects invalid signature", () => {
    const keyPair = generateSigningKeyPair();
    const data = "test message";
    const signature = signData(data, keyPair.privateKey);
    const tamperedData = "tampered message";
    const isValid = verifySignature(tamperedData, signature, keyPair.publicKey);
    expect(isValid).toBe(false);
  });

  it("works with Buffer data", () => {
    const keyPair = generateSigningKeyPair();
    const data = Buffer.from("binary data");
    const signature = signData(data, keyPair.privateKey);
    const isValid = verifySignature(data, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });

  it("computes consistent public key fingerprint", () => {
    const keyPair = generateSigningKeyPair();
    const fp1 = publicKeyFingerprint(keyPair.publicKey);
    const fp2 = publicKeyFingerprint(keyPair.publicKey);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
  });

  it("different keys have different fingerprints", () => {
    const keyPair1 = generateSigningKeyPair();
    const keyPair2 = generateSigningKeyPair();
    const fp1 = publicKeyFingerprint(keyPair1.publicKey);
    const fp2 = publicKeyFingerprint(keyPair2.publicKey);
    expect(fp1).not.toBe(fp2);
  });
});
