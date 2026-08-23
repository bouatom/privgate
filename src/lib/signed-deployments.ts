import { buildClientMsi, deploymentScript } from "./client-package";
import { signDeploymentArtifact } from "./deployment-signing";

export function buildAndSignMsi(apiBase: string, env?: Record<string, string | undefined>): Buffer {
  const msi = buildClientMsi(apiBase);
  signDeploymentArtifact(msi, env);
  return msi;
}

export function buildAndSignScript(
  apiBase: string,
  token: string,
  env?: Record<string, string | undefined>,
): string {
  const script = deploymentScript(apiBase, token);
  const signature = signDeploymentArtifact(script, env);
  return `${script}

# PrivGate Script Signature (Ed25519 base64):
# ${signature}
`;
}
