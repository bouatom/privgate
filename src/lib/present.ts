import "server-only";
import type { AuditEvent, DirectoryUser } from "./db";
import type { PresentedAudit, PresentedUser } from "./models";

export type { PresentedAudit, PresentedUser } from "./models";

export function presentUsers(users: DirectoryUser[]): PresentedUser[] {
  return users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    adSid: u.adSid,
    entraOid: u.entraOid,
    jitEligible: u.jitEligible === 1,
    disabled: u.disabled === 1,
    roles: JSON.parse(u.rolesJson) as string[],
  }));
}

export function presentAudit(events: AuditEvent[]): PresentedAudit[] {
  return events.map((e) => ({
    ...e,
    details: JSON.parse(e.details || "{}") as Record<string, unknown>,
  }));
}
