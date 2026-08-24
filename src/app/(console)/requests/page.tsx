import { can, getSession } from "@/lib/auth";
import { getDb, listPolicies, listRequests } from "@/lib/db";
import { Forbidden } from "../forbidden";
import { RequestsClient } from "./requests-client";

export default async function RequestsPage() {
  const session = await getSession();
  if (!can(session, "requests.view")) return <Forbidden />;
  const db = getDb();
  return (
    <RequestsClient
      rows={listRequests(db)}
      canApprove={can(session, "requests.approve")}
      canDeny={can(session, "requests.deny")}
      canManageAllowlists={can(session, "policies.manage")}
      policies={can(session, "policies.manage") ? listPolicies(db) : []}
    />
  );
}
