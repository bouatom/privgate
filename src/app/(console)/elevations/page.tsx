import Link from "next/link";
import { can, getSession } from "@/lib/auth";
import {
  canUseElevations,
  elevationTabHref,
  resolveElevationTab,
  visibleElevationTabs,
} from "@/lib/elevations-tabs";
import { getDb, listDeviceSummaries, listGroups, listJit, listPolicies, listRequests, listUacPrompts, listUsers } from "@/lib/db";
import { expireDueJit } from "@/lib/jit-expiry";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { JitClient } from "../jit/jit-client";
import { RequestsClient } from "../requests/requests-client";
import { UacPromptsClient } from "./uac-prompts-client";

type ElevationsSearchParams = { tab?: string };

export default async function ElevationsPage({
  searchParams,
}: {
  searchParams: Promise<ElevationsSearchParams>;
}) {
  const session = await getSession();
  if (!canUseElevations(session?.permissions)) return <Forbidden />;
  const params = await searchParams;
  const active = resolveElevationTab(params.tab, session?.permissions);
  const tabs = visibleElevationTabs(session?.permissions);
  const db = getDb();

  return (
    <>
      <div className="top">
        <div>
          <h1>Elevations</h1>
          <p className="lede">
            One place to grant and review elevated access: pending run-requests with risk scoring,
            stock Windows UAC prompts with frequency, and temporary local Administrators windows
            (15–60 minutes) that the broker revokes on schedule.
          </p>
        </div>
      </div>
      <div className="config-tabs">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={elevationTabHref(tab.id)}
            prefetch
            className={tab.id === active ? "active" : ""}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {active === "requests" ? (
        <RequestsClient
          rows={listRequests(db)}
          canApprove={can(session, "requests.approve")}
          canDeny={can(session, "requests.deny")}
          canManageAllowlists={can(session, "policies.manage")}
          policies={can(session, "policies.manage") ? listPolicies(db) : []}
        />
      ) : null}
      {active === "prompts" ? (
        <UacPromptsClient
          rows={listUacPrompts(db)}
          canManageAllowlists={can(session, "policies.manage")}
          policies={can(session, "policies.manage") ? listPolicies(db) : []}
        />
      ) : null}
      {active === "jit" ? (
        <JitPanel session={session} db={db} />
      ) : null}
    </>
  );
}

function JitPanel({
  session,
  db,
}: {
  session: Awaited<ReturnType<typeof getSession>>;
  db: ReturnType<typeof getDb>;
}) {
  expireDueJit();
  return (
    <JitClient
      users={presentUsers(listUsers(db))}
      groups={listGroups(db).filter((g) => g.memberCount > 0)}
      devices={listDeviceSummaries(db)}
      grants={listJit(db)}
      canGrant={can(session, "jit.grant")}
      canRevoke={can(session, "jit.revoke")}
    />
  );
}
