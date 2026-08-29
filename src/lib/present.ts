import "server-only";
import type { AuditEvent, DirectoryUser } from "./db";
import type { PresentedAudit, PresentedUser } from "./models";
import { accountKindOf, effectiveRoleFor } from "./elevation";

export type { PresentedAudit, PresentedUser } from "./models";

/**
 * Present directory users with real classification: effectiveRole comes from
 * actual membership in high-privilege groups (passed in by the caller), and
 * MSOL-style sync/service accounts are flagged — never filtered out.
 */
export function presentUsers(
  users: DirectoryUser[],
  context: { membershipsByUser?: ReadonlyMap<string, Array<{ name: string; objectId?: string }>> } = {},
): PresentedUser[] {
  return users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    adSid: u.adSid,
    entraOid: u.entraOid,
    roles: JSON.parse(u.rolesJson) as string[],
    effectiveRole: effectiveRoleFor(context.membershipsByUser?.get(u.id) ?? []),
    accountKind: accountKindOf(u.userPrincipalName),
  }));
}

/**
 * Present audit events. Pass `resolveActor` to swap raw actor ids (e.g.
 * "device:<uuid>") for friendly names (hostnames) where resolvable; actors the
 * resolver cannot map are left verbatim so the audit log stays truthful.
 */
export function presentAudit(
  events: AuditEvent[],
  resolveActor?: (actor: string) => string | null | undefined,
): PresentedAudit[] {
  const resolved = new Map<string, string>();
  return events.map((e) => ({
    ...e,
    actor: resolveActor ? resolveWithCache(resolveActor, resolved, e.actor) : e.actor,
    details: JSON.parse(e.details || "{}") as Record<string, unknown>,
  }));
}

function resolveWithCache(
  resolve: (actor: string) => string | null | undefined,
  cache: Map<string, string>,
  actor: string,
): string {
  const cached = cache.get(actor);
  if (cached !== undefined) return cached;
  const name = resolve(actor);
  const display = name ? name : actor;
  cache.set(actor, display);
  return display;
}
