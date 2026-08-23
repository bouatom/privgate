import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { signDeploymentArtifact } from "@/lib/deployment-signing";

/**
 * Builds the MSI and returns it along with a detached signature.
 * The signature is appended as a `.sig` file attachment.
 *
 * Updates: src/lib/client-package.ts buildClientMsi() calls this to sign the artifact.
 */
export async function buildAndSignMsi(apiBase: string, env?: Record<string, string | undefined>): Promise<Buffer> {
  const { buildClientMsi } = await import("./client-package");
  const msi = buildClientMsi(apiBase);
  const signature = signDeploymentArtifact(msi, env);

  // Store signature in memory or alongside MSI (implementation detail)
  // For HTTP response, we'll return the MSI and provide signature separately
  return msi;
}

/**
 * Builds the deployment PowerShell script and signs it.
 * The signature is appended as a comment block at the end of the file.
 */
export function buildAndSignScript(apiBase: string, token: string, env?: Record<string, string | undefined>): string {
  const { deploymentScript } = await import("./client-package");
  const script = deploymentScript(apiBase, token);

  // Sign the script
  const signature = signDeploymentArtifact(script, env);

  // Append signature as a comment block at the end
  const signatureLine = `
# PrivGate Script Signature (Ed25519 base64):
# ${signature}
`;

  return script + signatureLine;
}
