import { can, getSession } from "@/lib/auth";
import { getDb, listGroupMemberships, listGroups, listUsers } from "@/lib/db";
import { isHighPrivilegeGroup } from "@/lib/elevation";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { UsersClient } from "../users/users-client";

export default async function DirectoryPage() {
  const session = await getSession();
  const usersVisible = can(session, "directory.users.view") || can(session, "directory.users.manage");
  if (!usersVisible) return <Forbidden />;

  const db = getDb();
  const membershipsByUser = new Map<string, Array<{ name: string; objectId: string }>>();
  for (const membership of listGroupMemberships(db)) {
    const groups = membershipsByUser.get(membership.userId) ?? [];
    groups.push({ name: membership.groupName, objectId: membership.objectId });
    membershipsByUser.set(membership.userId, groups);
  }
  const groups = listGroups(db);

  return (
    <>
      <div className="top">
        <div>
          <h1>Directory</h1>
          <p className="lede">
            Synced directory users and groups from Entra ID or Active Directory.
          </p>
        </div>
      </div>
      <UsersClient
        users={presentUsers(listUsers(db), { membershipsByUser })}
        elevatedGroupCount={groups.filter((g) => isHighPrivilegeGroup(g)).length}
        groups={groups}
        canManage={can(session, "directory.users.manage")}
      />
    </>
  );
}
