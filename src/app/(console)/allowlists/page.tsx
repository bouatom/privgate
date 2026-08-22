import { can, getSession } from "@/lib/auth";
import { getDb, listGroups, listPolicies } from "@/lib/db";
import { Forbidden } from "../forbidden";
import { AllowlistsClient } from "./allowlists-client";

export default async function AllowlistsPage() {
  const session = await getSession();
  if (!can(session, "policies.view") && !can(session, "policies.manage")) return <Forbidden />;
  const db = getDb();
  return <AllowlistsClient rows={listPolicies(db)} groups={listGroups(db)} canManage={can(session, "policies.manage")} />;
}
