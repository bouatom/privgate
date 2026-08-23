import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./bootstrap";

export interface SigningKeyPair {
  publicKey: string; // PEM format
  privateKey: string; // PEM format
}

const SIGNING_KEY_DIR = "signing";
const PRIVATE_KEY_FILE = "signing.pem";
const PUBLIC_KEY_FILE = "signing.pub";

/**
 * Gets the directory where signing keys are stored.
 * Uses PRIVGATE_DATA_DIR by default.
 */
export function signingKeyDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(dataDir(env), SIGNING_KEY_DIR);
}

/**
 * Generates a new Ed25519 key pair.
 * @returns { publicKey, privateKey } in PEM format
 */
export function generateSigningKeyPair(): SigningKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: {
      format: "pem",
      type: "pkcs8",
    },
    publicKeyEncoding: {
      format: "pem",
      type: "spki",
    },
  });
  return { publicKey, privateKey };
}

/**
 * Ensures signing keys exist, generating them if necessary.
 * Keys are stored in ProgramData/PrivGate/signing/ (Windows) or /var/lib/privgate/signing/ (Unix).
 *
 * @param env Environment variables
 * @returns { publicKey, privateKey } in PEM format
 */
export function ensureSigningKeys(env: Record<string, string | undefined> = process.env): SigningKeyPair {
  const keyDir = signingKeyDir(env);
  const privateKeyPath = path.join(keyDir, PRIVATE_KEY_FILE);
  const publicKeyPath = path.join(keyDir, PUBLIC_KEY_FILE);

  // Check if keys already exist
  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    const privateKey = fs.readFileSync(privateKeyPath, "utf8");
    const publicKey = fs.readFileSync(publicKeyPath, "utf8");
    return { publicKey, privateKey };
  }

  // Generate new keys
  const keyPair = generateSigningKeyPair();

  // Create directory with restricted permissions
  try {
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  } catch {
    // Directory may already exist
  }

  // Write private key (readable only by process owner)
  fs.writeFileSync(privateKeyPath, keyPair.privateKey, { mode: 0o600 });

  // Write public key (readable by all)
  fs.writeFileSync(publicKeyPath, keyPair.publicKey, { mode: 0o644 });

  return keyPair;
}

/**
 * Signs data with the private key.
 * @param data Data to sign (Buffer or string)
 * @param privateKey Private key in PEM format
 * @returns Base64-encoded signature
 */
export function signData(data: Buffer | string, privateKey: string): string {
  const sign = crypto.createSign("SHA256");
  sign.update(data);
  const signature = sign.sign({ key: privateKey, format: "pem", type: "pkcs8" });
  return signature.toString("base64");
}

/**
 * Verifies a signature with the public key.
 * @param data Original data (Buffer or string)
 * @param signature Base64-encoded signature
 * @param publicKey Public key in PEM format
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(data: Buffer | string, signature: string, publicKey: string): boolean {
  try {
    const verify = crypto.createVerify("SHA256");
    verify.update(data);
    const sig = Buffer.from(signature, "base64");
    return verify.verify({ key: publicKey, format: "pem", type: "spki" }, sig);
  } catch {
    return false;
  }
}

/**
 * Computes SHA256 fingerprint of a public key for display/verification.
 * @param publicKey Public key in PEM format
 * @returns Hex-encoded SHA256 fingerprint
 */
export function publicKeyFingerprint(publicKey: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(publicKey);
  return hash.digest("hex");
}
