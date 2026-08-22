import { can, getSession } from "@/lib/auth";
import { getDb, listRequests } from "@/lib/db";
import { Forbidden } from "../forbidden";
import { RequestsClient } from "./requests-client";

export default async function RequestsPage() {
  const session = await getSession();
  if (!can(session, "requests.view")) return <Forbidden />;
  return (
    <RequestsClient
      rows={listRequests(getDb())}
      canApprove={can(session, "requests.approve")}
      canDeny={can(session, "requests.deny")}
    />
  );
}
