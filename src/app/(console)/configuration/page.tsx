import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { identitySummary, settingsOverview } from "@/lib/settings-overview";
import { CONFIG_TABS, hasAnyPermission } from "@/lib/permissions";
import { Forbidden } from "../forbidden";

export const dynamic = "force-dynamic";

/**
 * Settings home: one status card per configuration tab, gated by the same
 * permission anyOf as the tab itself. Admins & Roles lives in the side
 * navigation, not here — this page is about the control plane, not its people.
 */
const SETTINGS_HREFS = [
  "/configuration/network",
  "/configuration/integrations",
  "/configuration/notifications",
  "/configuration/updates",
];

export default async function ConfigurationHome() {
  const session = await getSession();
  const tabs = CONFIG_TABS.filter(
    (tab) => SETTINGS_HREFS.includes(tab.href) && hasAnyPermission(session?.permissions, tab.anyOf),
  );
  if (tabs.length === 0) return <Forbidden />;
  const overview = settingsOverview(getDb());

  const identity = overview.identity;
  const sources = [
    identity.entra.connected ? `Entra${identity.entra.name ? ` (${identity.entra.name})` : ""}` : null,
    identity.ad.connected ? `AD (${identity.ad.name})` : null,
  ].filter(Boolean) as string[];
  const alertChannel = overview.notifications.emailEnabled && overview.notifications.webhookEnabled
    ? "Email and webhook alerts"
    : overview.notifications.emailEnabled
      ? "Email alerts only"
      : overview.notifications.webhookEnabled
        ? "Webhook alerts only"
        : "Alerts are off";

  const bodies: Record<string, React.ReactNode> = {
    "/configuration/network": (
      <>
        <p className="card-note">
          Web port {overview.server.webPort} · Broker port {overview.server.agentPort}
          {overview.server.splitPorts ? "" : " (shared)"}
          <br />
          Bound to <span className="mono">{overview.server.bind}</span>
          {overview.server.loopback ? (
            <>
              {" "}
              <span className="err">— this machine only</span>
            </>
          ) : null}
        </p>
        {overview.server.lanUrls[0] ? (
          <p className="card-note">
            Reachable at <span className="mono">{overview.server.lanUrls[0]}</span>
          </p>
        ) : null}
      </>
    ),
    "/configuration/integrations": (
      <>
        <p className="card-note">{sources.length > 0 ? sources.join(" · ") : identitySummary(overview)}</p>
        <p className="card-note">
          {identity.entra.connected || identity.ad.connected
            ? "Users and groups sync from these sources into the directory."
            : "Connect Entra ID or Active Directory to bring directory users into the console."}
        </p>
      </>
    ),
    "/configuration/notifications": (
      <p className="card-note">
        {alertChannel}
        {overview.notifications.emailEnabled && overview.notifications.recipients
          ? ` to ${overview.notifications.recipients}`
          : ""}
      </p>
    ),
    "/configuration/updates": (
      <>
        <p className="card-note">
          Console v{overview.updates.version} · {overview.updates.channel} channel
          {overview.updates.available ? (
            <>
              <br />
              <span className="err">Update available: v{overview.updates.availableVersion}</span>
            </>
          ) : null}
        </p>
      </>
    ),
  };

  return (
    <>
      <div className="top">
        <div>
          <h1>Settings</h1>
          <p className="lede">
            The control plane: identity sources, notifications, server networking, and console updates.
          </p>
        </div>
      </div>

      <div className="grid cards four dash-section">
        {tabs.map((tab) => (
          <Link className={`card${tab.href === "/configuration/updates" && overview.updates.available ? " danger" : ""}`} key={tab.href} href={tab.href} prefetch>
            <div className="card-head">
              <div className="k">{tab.label}</div>
            </div>
            {bodies[tab.href]}
            <span className="mono dash-link">Open {tab.label} →</span>
          </Link>
        ))}
      </div>
    </>
  );
}