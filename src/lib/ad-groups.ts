import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { dnsDomainFromBaseDn, ldapScalar, sidFromBinary, usersFromLdapEntries } from "./ad-sid";
import { accountKindOf } from "./elevation";
import { replaceGroups } from "./db/directory";
import { getUserByUpn, upsertUsers } from "./db/users";

/**
 * LDAP filter for security groups only: bit 0x80000000 (ADS_GROUP_TYPE_
 * SECURITY_ENABLED) must be set. Distribution lists are never synced.
 */
export const AD_GROUP_FILTER =
  "(&(objectClass=group)(groupType:1.2.840.113556.1.4.803:=2147483648))";

export const AD_GROUP_ATTRIBUTES = ["cn", "objectSid", "member"];

export type AdGroupPlan = {
  /** objectSid when present, else the distinguished name — stable across syncs. */
  id: string;
  name: string;
  objectId: string;
  dn: string;
  memberUpns: string[];
};

function entryDn(entry: Record<string, unknown>): string {
  return typeof entry.dn === "string" ? entry.dn.trim() : "";
}

function ldapList(value: unknown): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Entra Connect / MSOL sync accounts are service noise: they sit in real AD
 * groups but must never leak into membership-driven scopes.
 */
function isAdServiceAccount(sam: string, upn: string): boolean {
  return /^msol_/i.test(sam) || accountKindOf(upn) === "service";
}

/** lowercase DN → UPN for syncable user entries; service accounts are excluded. */
export function adUserDnIndex(entries: Array<Record<string, unknown>>, baseDn: string): Map<string, string> {
  const dns = dnsDomainFromBaseDn(baseDn);
  const index = new Map<string, string>();
  for (const entry of entries) {
    const dn = entryDn(entry);
    if (!dn) continue;
    const sam = ldapScalar(entry.sAMAccountName);
    const upn = ldapScalar(entry.userPrincipalName) || (sam && dns ? `${sam}@${dns}` : "");
    if (!upn || isAdServiceAccount(sam, upn)) continue;
    index.set(dn.toLowerCase(), upn);
  }
  return index;
}

/** Map raw LDAP group entries to persistable plans; unresolvable members drop out. */
export function groupsFromLdapEntries(
  entries: Array<Record<string, unknown>>,
  usersByDn: Map<string, string>,
): AdGroupPlan[] {
  const plans: AdGroupPlan[] = [];
  for (const entry of entries) {
    const dn = entryDn(entry);
    const name = ldapScalar(entry.cn);
    // Entries without cn/dn are not group objects (guards fake/partial payloads).
    if (!dn || !name) continue;
    const sid = sidFromBinary(entry.objectSid);
    const memberUpns: string[] = [];
    for (const memberDn of ldapList(entry.member)) {
      const upn = usersByDn.get(memberDn.toLowerCase());
      if (upn && !memberUpns.includes(upn)) memberUpns.push(upn);
    }
    plans.push({ id: sid || dn, name, objectId: sid, dn, memberUpns });
  }
  return plans.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Persist one AD connector sync pass: upsert the user rows first, then store
 * security groups scoped to source 'ad' with resolved member user ids. Runs
 * alongside the existing user sync inside the same LDAP session in ad-ldap.ts.
 */
export function applyAdDirectorySync(
  db: DatabaseSync,
  userEntries: Array<Record<string, unknown>>,
  groupEntries: Array<Record<string, unknown>>,
  baseDn: string,
): { users: number; groups: number } {
  const users = usersFromLdapEntries(userEntries, baseDn);
  upsertUsers(
    db,
    users.map((user) => ({
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      adSid: user.adSid || undefined,
    })),
  );
  const usersByDn = adUserDnIndex(userEntries, baseDn);
  const plans = groupsFromLdapEntries(groupEntries, usersByDn);
  replaceGroups(
    db,
    plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      objectId: plan.objectId,
      dn: plan.dn,
      memberUserIds: plan.memberUpns
        .map((upn) => getUserByUpn(db, upn)?.id)
        .filter((id): id is string => Boolean(id)),
    })),
    "ad",
  );
  return { users: users.length, groups: plans.length };
}
