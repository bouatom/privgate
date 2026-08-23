import "server-only";
import { signData, ensureSigningKeys } from "./signing-keys";
import { readFileSync } from "node:fs";

/**
 * Signs a deployment artifact (MSI or script) and returns the signature.
 * @param artifactBuffer The artifact file buffer (MSI binary or script text)
 * @param env Environment variables (for key location)
 * @returns Base64-encoded signature
 */
export function signDeploymentArtifact(artifactBuffer: Buffer | string, env?: Record<string, string | undefined>): string {
  const keys = ensureSigningKeys(env);
  return signData(artifactBuffer, keys.privateKey);
}

/**
 * Computes the hex fingerprint of the public signing key.
 * Used in GitHub Release notes and documentation.
 * @param env Environment variables (for key location)
 * @returns Hex-encoded SHA256 fingerprint
 */
export function getPublicKeyFingerprint(env?: Record<string, string | undefined>): string {
  const { publicKeyFingerprint } = await import("./signing-keys");
  const keys = ensureSigningKeys(env);
  return publicKeyFingerprint(keys.publicKey);
}
