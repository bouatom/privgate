import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getAdSettings, getNotificationSettings } from "@/lib/db";
import { installedConsoleVersionInfo, type ResolvedVersion } from "@/lib/console-version";
import { publicDirectoryStatus } from "@/lib/entra-connect-sync";
import { getUpdateChannel } from "@/lib/setup-state";
import { cachedCheck } from "@/lib/self-update-service";
import type { UpdateChannel } from "@/lib/self-update";
import { isLoopbackBind, lanUrls, listenConfig } from "@/lib/listen";

/**
 * Snapshot of every settings area for the Configuration home page.
 *
 * One row per CONFIG_TABS tab (network, integrations, notifications, updates).
 * Server and identity rows also power the Server & network tab and the
 * dashboard Directory card — keep this the single place those facts are
 * composed, so the Settings home and the network tab can't drift apart.
 */

export type IdentitySourceStatus = {
  connected: boolean;
  /** Human name: Entra tenant display name or AD host, when known. */
  name: string | null;
  lastSyncAt: string | null;
};

export type SettingsOverview = {
  identity: {
    entra: IdentitySourceStatus;
    ad: IdentitySourceStatus;
  };
  notifications: {
    emailEnabled: boolean;
    webhookEnabled: boolean;
    enabled: boolean;
    recipients: string;
  };
  updates: {
    version: string;
    versionSource: ResolvedVersion["source"];
    channel: UpdateChannel;
    available: boolean;
    availableVersion: string | null;
    checkedAt: string | null;
  };
  server: {
    bind: string;
    webPort: number;
    agentPort: number;
    splitPorts: boolean;
    loopback: boolean;
    lanUrls: string[];
  };
};

export function settingsOverview(
  db: DatabaseSync,
  env: Record<string, string | undefined> = process.env,
): SettingsOverview {
  const entra = publicDirectoryStatus(db);
  const ad = getAdSettings(db);
  const notifications = getNotificationSettings(db);
  const check = cachedCheck();
  const installed = installedConsoleVersionInfo(env);
  const cfg = listenConfig(env);

  return {
    identity: {
      entra: {
        connected: entra.connected,
        name: entra.connected ? (entra.tenantName || null) : null,
        lastSyncAt: entra.connected ? (entra.lastSyncAt || null) : null,
      },
      ad: {
        connected: ad.configured,
        name: ad.configured ? ad.host : null,
        lastSyncAt: ad.lastSyncAt,
      },
    },
    notifications: {
      emailEnabled: notifications.emailEnabled,
      webhookEnabled: notifications.webhookEnabled,
      enabled: notifications.emailEnabled || notifications.webhookEnabled,
      recipients: notifications.recipients,
    },
    updates: {
      version: installed.version,
      versionSource: installed.source,
      channel: getUpdateChannel(db),
      available: Boolean(check?.available),
      availableVersion: check?.available ? check.version ?? null : null,
      checkedAt: check?.checkedAt ?? null,
    },
    server: {
      bind: cfg.bind,
      webPort: cfg.webPort,
      agentPort: cfg.agentPort,
      splitPorts: cfg.splitPorts,
      loopback: isLoopbackBind(cfg.bind),
      lanUrls: lanUrls(cfg.webPort, cfg.bind),
    },
  };
}

/** Short status line for the identity card (Entra + AD together). */
export function identitySummary(overview: SettingsOverview): string {
  const parts: string[] = [];
  if (overview.identity.entra.connected) parts.push(`Entra${overview.identity.entra.name ? ` (${overview.identity.entra.name})` : ""}`);
  if (overview.identity.ad.connected) parts.push(`AD (${overview.identity.ad.name})`);
  return parts.length > 0 ? parts.join(" · ") : "No identity sources connected";
}