import "server-only";
import { NextResponse } from "next/server";

interface SigningKeyResponse {
  algorithm: string;
  publicKey: string;
  fingerprint: string;
}

/**
 * GET /api/public/signing-key
 * Returns the public signing key for deployment artifact verification.
 * This endpoint is unauthenticated to allow offline verification.
 */
export async function GET(): Promise<NextResponse<SigningKeyResponse>> {
  const { ensureSigningKeys, publicKeyFingerprint } = await import("@/lib/signing-keys");
  const keys = ensureSigningKeys(process.env);

  return NextResponse.json(
    {
      algorithm: "Ed25519",
      publicKey: keys.publicKey,
      fingerprint: publicKeyFingerprint(keys.publicKey),
    },
    {
      headers: {
        "cache-control": "public, max-age=3600", // Cache for 1 hour
        "content-type": "application/json",
      },
    },
  );
}
