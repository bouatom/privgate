import { can, getSession } from "@/lib/auth";
import { getDb, getElevationSettings, groupIdsForUser, listGroups, listPolicies, listRequests } from "@/lib/db";
import type { PreviewableRequest, UserGroupIds } from "@/lib/policy-draft-preview";
import { policyTabHref, POLICIES_TABS, resolvePolicyTab } from "@/lib/policies-tabs";
import Link from "next/link";
import { Forbidden } from "../forbidden";
import { AllowlistsClient } from "./allowlists-client";
import { ElevationSettingsClient } from "./elevation-settings-client";

const PREVIEW_LIMIT = 25;

const RULES_LEDE =
  "Always-allow rules that match programs by SHA-256 and publisher, then elevate silently, deny, or require approval. Shells and scripting hosts cannot be allowed silently. You can also create a rule from a device elevation log or a blocked request — that copies the recorded hash, publisher, and arguments.";

const ELEVATION_LEDE =
  "Choose what happens on PCs after a standard user hits Windows UAC. This applies to the whole environment. Always-allow rules and elevation requests are unchanged.";

export default async function AllowlistsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "policies.view") && !can(session, "policies.manage")) return <Forbidden />;
  const active = resolvePolicyTab((await searchParams).tab);
  const db = getDb();
  const canSeeRequests = can(session, "requests.view");
  let recentRequests: PreviewableRequest[] = [];
  const userGroupIds: UserGroupIds = {};
  if (active === "rules" && canSeeRequests) {
    recentRequests = listRequests(db).slice(0, PREVIEW_LIMIT).map((r) => ({
      id: r.id,
      userId: r.userId,
      deviceId: r.deviceId,
      filePath: r.filePath,
      fileHash: r.fileHash,
      publisher: r.publisher,
      arguments: r.arguments,
      requestedAt: r.requestedAt,
      userName: r.userName,
      hostname: r.hostname,
    }));
    for (const userId of [...new Set(recentRequests.map((r) => r.userId))]) {
      userGroupIds[userId] = groupIdsForUser(db, userId);
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Policies</h1>
          <p className="lede">{active === "elevation" ? ELEVATION_LEDE : RULES_LEDE}</p>
        </div>
      </div>
      <div className="config-tabs">
        {POLICIES_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={policyTabHref(tab.id)}
            prefetch
            className={tab.id === active ? "active" : ""}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {active === "elevation" ? (
        <ElevationSettingsClient
          initial={getElevationSettings(db).uacMode}
          canManage={can(session, "policies.manage")}
        />
      ) : (
        <AllowlistsClient
          rows={listPolicies(db)}
          groups={listGroups(db)}
          canManage={can(session, "policies.manage")}
          recentRequests={recentRequests}
          userGroupIds={userGroupIds}
        />
      )}
    </>
  );
}
