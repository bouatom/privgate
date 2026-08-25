/**
 * Directory identity classification heuristics.
 *
 * Pure string logic — no db, no server-only imports — so both the presentation
 * layer and tests can use it. Heuristics are advisory labels only: they are
 * rendered as badges and never used to auto-include/exclude anyone from
 * anything silently.
 */

/** Group name fragments that indicate the group grants real admin rights. */
const HIGH_PRIVILEGE_NAME_PATTERNS = [
  /domain\s+admins/i,
  /enterprise\s+admins/i,
  /administrators/i,
  /schema\s+admins/i,
];

/**
 * Well-known admin SIDs, stable across localized directories:
 *  - S-1-5-32-544  Builtin\Administrators
 *  - S-1-5-<domain subauthorities>-512  Domain Admins
 *  - S-1-5-<domain subauthorities>-519  Enterprise Admins
 * Some directory syncs store a SID in the group's objectId column.
 */
const WELL_KNOWN_ADMIN_SID_PATTERN = /^(S-1-5-32-544|S-1-5-(?:\d+-)+(?:512|519))$/i;

export function isWellKnownAdminSid(value: string): boolean {
  return WELL_KNOWN_ADMIN_SID_PATTERN.test(value.trim());
}

export function isHighPrivilegeGroup(group: { name: string; objectId?: string }): boolean {
  const name = group.name || "";
  if (HIGH_PRIVILEGE_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return Boolean(group.objectId && isWellKnownAdminSid(group.objectId));
}

export type EffectiveRole = "standard" | "elevated-admin";

/** Real elevation status derived from actual high-privilege group membership. */
export function effectiveRoleFor(memberships: Array<{ name: string; objectId?: string }>): EffectiveRole {
  return memberships.some((group) => isHighPrivilegeGroup(group)) ? "elevated-admin" : "standard";
}

export type AccountKind = "human" | "service";

/**
 * Entra Connect sync/service accounts typically carry an `MSOL_` UPN prefix or
 * live under an `msol.` domain subtree. They are flagged so admins can tell
 * them apart — they are never filtered out of any view.
 */
export function accountKindOf(userPrincipalName: string): AccountKind {
  const upn = userPrincipalName.trim();
  if (/^msol_/i.test(upn)) return "service";
  const domain = upn.split("@")[1] ?? "";
  if (/^msol\./i.test(domain)) return "service";
  return "human";
}
