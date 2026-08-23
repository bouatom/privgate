import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { Client } from "ldapts";
import { usersFromLdapEntries } from "./ad-sid";
import { getAdBindPassword, getAdSettings, saveAdSettings } from "./db/ad";
import { upsertUsers } from "./db/users";

export type LdapSession = {
  bind(dn: string, password: string): Promise<void>;
  search(
    baseDn: string,
    options: {
      scope: "sub";
      filter: string;
      attributes: string[];
      paged: { pageSize: number };
      explicitBufferAttributes: string[];
    },
  ): Promise<{ searchEntries: Array<Record<string, unknown>> }>;
  unbind(): Promise<void>;
};

export type OpenLdap = (settings: { host: string; port: number; useTls: boolean }) => Promise<LdapSession>;

const SEARCH_ATTRIBUTES = ["displayName", "cn", "userPrincipalName", "sAMAccountName", "objectSid"];

export function ldapUrl(host: string, port: number, useTls: boolean): string {
  const trimmed = host.trim();
  if (!trimmed || /[/\\?#]/.test(trimmed)) throw new Error("Invalid domain controller host.");
  const hostPart = trimmed.includes(":") && !trimmed.startsWith("[") ? `[${trimmed}]` : trimmed;
  return `${useTls ? "ldaps" : "ldap"}://${hostPart}:${port}`;
}

export async function defaultOpenLdap(settings: { host: string; port: number; useTls: boolean }): Promise<LdapSession> {
  const client = new Client({
    url: ldapUrl(settings.host, settings.port, settings.useTls),
    timeout: 15_000,
    connectTimeout: 12_000,
    tlsOptions: settings.useTls ? { rejectUnauthorized: false } : undefined,
  });
  return client as unknown as LdapSession;
}

let openLdap: OpenLdap = defaultOpenLdap;

export function setOpenLdapForTests(next?: OpenLdap) {
  openLdap = next ?? defaultOpenLdap;
}

function requireBind(settings: { host: string; bindDn: string }, password: string) {
  if (!settings.host.trim()) throw new Error("Save a domain controller host first.");
  if (!settings.bindDn.trim() || !password) throw new Error("Save a bind DN and password first.");
}

export async function testAdBind(db: DatabaseSync): Promise<void> {
  const settings = getAdSettings(db);
  const password = getAdBindPassword(db);
  requireBind(settings, password);
  const client = await openLdap(settings);
  try {
    await client.bind(settings.bindDn, password);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

export async function syncAdUsers(db: DatabaseSync): Promise<{ users: number }> {
  const settings = getAdSettings(db);
  const password = getAdBindPassword(db);
  requireBind(settings, password);
  if (!settings.baseDn.trim()) throw new Error("Save a base DN first.");
  const client = await openLdap(settings);
  try {
    await client.bind(settings.bindDn, password);
    const { searchEntries } = await client.search(settings.baseDn, {
      scope: "sub",
      filter: settings.userFilter,
      attributes: SEARCH_ATTRIBUTES,
      paged: { pageSize: 500 },
      explicitBufferAttributes: ["objectSid"],
    });
    const users = usersFromLdapEntries(searchEntries, settings.baseDn);
    upsertUsers(
      db,
      users.map((user) => ({
        displayName: user.displayName,
        userPrincipalName: user.userPrincipalName,
        adSid: user.adSid || undefined,
      })),
    );
    saveAdSettings(db, { lastSyncAt: new Date().toISOString(), lastError: "" });
    return { users: users.length };
  } finally {
    await client.unbind().catch(() => undefined);
  }
}
