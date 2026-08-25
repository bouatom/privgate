import { can, getSession } from "@/lib/auth";
import { getDb, listGroupMemberships, listGroups, listUsers } from "@/lib/db";
import { isHighPrivilegeGroup } from "@/lib/elevation";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const session = await getSession();
  if (!can(session, "directory.users.view") && !can(session, "directory.users.manage")) return <Forbidden />;
  const db = getDb();
  const membershipsByUser = new Map<string, Array<{ name: string; objectId: string }>>();
  for (const membership of listGroupMemberships(db)) {
    const groups = membershipsByUser.get(membership.userId) ?? [];
    groups.push({ name: membership.groupName, objectId: membership.objectId });
    membershipsByUser.set(membership.userId, groups);
  }
  const groups = listGroups(db);
  return (
    <UsersClient
      users={presentUsers(listUsers(db), { membershipsByUser })}
      // Only genuinely high-privilege groups feed the elevation badge.
      elevatedGroupCount={groups.filter((g) => isHighPrivilegeGroup(g)).length}
      groups={groups}
      canManage={can(session, "directory.users.manage")}
    />
  );
}
