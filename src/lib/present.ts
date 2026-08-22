import type { AuditEvent, DirectoryUser } from "./db";

export type PresentedUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  adSid: string;
  entraOid: string;
  jitEligible: boolean;
  disabled: boolean;
  roles: string[];
};

export type PresentedAudit = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
};

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
