import { can, getSession } from "@/lib/auth";
import { getDb, groupIdsForUser, listGroups, listPolicies, listRequests } from "@/lib/db";
import type { PreviewableRequest, UserGroupIds } from "@/lib/policy-draft-preview";
import { Forbidden } from "../forbidden";
import { AllowlistsClient } from "./allowlists-client";

const PREVIEW_LIMIT = 25;

export default async function AllowlistsPage() {
  const session = await getSession();
  if (!can(session, "policies.view") && !can(session, "policies.manage")) return <Forbidden />;
  const db = getDb();
  // The match preview reads recorded requests — the same data as the requests
  // queue — so only share it with viewers who may already read that queue.
  const canSeeRequests = can(session, "requests.view");
  let recentRequests: PreviewableRequest[] = [];
  const userGroupIds: UserGroupIds = {};
  if (canSeeRequests) {
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
    <AllowlistsClient
      rows={listPolicies(db)}
      groups={listGroups(db)}
      canManage={can(session, "policies.manage")}
      recentRequests={recentRequests}
      userGroupIds={userGroupIds}
    />
  );
}
