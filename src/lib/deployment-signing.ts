import "server-only";
import { signData, ensureSigningKeys, publicKeyFingerprint } from "./signing-keys";

/**
 * Signs a deployment artifact (MSI or script) and returns the signature.
 */
export function signDeploymentArtifact(
  artifactBuffer: Buffer | string,
  env?: Record<string, string | undefined>,
): string {
  const keys = ensureSigningKeys(env);
  return signData(artifactBuffer, keys.privateKey);
}

/**
 * Hex fingerprint of the public signing key for release notes.
 */
export function getPublicKeyFingerprint(env?: Record<string, string | undefined>): string {
  const keys = ensureSigningKeys(env);
  return publicKeyFingerprint(keys.publicKey);
}
