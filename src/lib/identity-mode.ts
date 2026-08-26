export type IdentityMode = "none" | "ad" | "entra" | "hybrid";

export function identityMode(input: { entraConnected: boolean; adConfigured: boolean }): IdentityMode {
  if (input.entraConnected && input.adConfigured) return "hybrid";
  if (input.entraConnected) return "entra";
  if (input.adConfigured) return "ad";
  return "none";
}

/** Status line on Configuration → Identity Sources. Sources stay independent. */
export const IDENTITY_MODE_COPY: Record<IdentityMode, { title: string; body: string }> = {
  none: {
    title: "No directory connected",
    body: "Active Directory and Entra ID are optional and independent. Connect one, both (hybrid), or neither. Users and groups will sync once a directory is connected.",
  },
  ad: {
    title: "Active Directory only",
    body: "On-premises AD is connected. Entra ID is optional if you later want cloud users or portal SSO. AD settings are never used for Entra.",
  },
  entra: {
    title: "Entra ID only",
    body: "Cloud identity via Entra ID. Active Directory is optional if you later need on-prem SIDs from a domain controller. Entra settings are never used for AD.",
  },
  hybrid: {
    title: "Hybrid (AD and Entra ID)",
    body: "Both directories are connected independently. Users merge on user principal name. On-prem SIDs and Entra object IDs are kept even when the other directory omits them.",
  },
};
