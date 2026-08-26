import Link from "next/link";
import { can, getSession, type AdminSession } from "@/lib/auth";
import { getDb, listGroupMemberships, listGroups, listUsers } from "@/lib/db";
import { resolveDirectoryTab, type DirectoryTab } from "@/lib/directory-tabs";
import { isHighPrivilegeGroup } from "@/lib/elevation";
import { listPortalUsers, listRoles } from "@/lib/portal";
import { presentUsers } from "@/lib/present";
import { AccessClient } from "../configuration/access/access-client";
import { Forbidden } from "../forbidden";
import { UsersClient } from "../users/users-client";

type DirectorySearchParams = { tab?: string };

function tabHref(tab: DirectoryTab): string {
  return tab === "admins" ? "/directory?tab=admins" : "/directory";
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const session = await getSession();
  const usersVisible = can(session, "directory.users.view") || can(session, "directory.users.manage");
  const adminsVisible = can(session, "portal.users.manage") || can(session, "portal.roles.manage");
  if (!usersVisible && !adminsVisible) return <Forbidden />;
  const params = await searchParams;
  const active = resolveDirectoryTab(session?.permissions, params.tab);

  return (
    <>
      <div className="top">
        <div>
          <h1>Directory</h1>
          <p className="lede">Synced directory users and the portal admins who manage this console.</p>
        </div>
      </div>
      <div className="config-tabs">
        {usersVisible ? (
          <Link href={tabHref("users")} prefetch className={active === "users" ? "active" : ""}>
            Users &amp; groups
          </Link>
        ) : null}
        {adminsVisible ? (
          <Link href={tabHref("admins")} prefetch className={active === "admins" ? "active" : ""}>
            Admins &amp; roles
          </Link>
        ) : null}
      </div>
      {active === "users" ? <UsersTab session={session} /> : <AdminsTab session={session} />}
    </>
  );
}

async function UsersTab({ session }: { session: AdminSession | null }) {
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

async function AdminsTab({ session }: { session: AdminSession | null }) {
  if (!can(session, "portal.users.manage") && !can(session, "portal.roles.manage")) {
    return <Forbidden message="Only Master Admins can manage portal users and roles." />;
  }
  const db = getDb();
  return (
    <AccessClient
      users={listPortalUsers(db)}
      roles={listRoles(db)}
      canManageUsers={can(session, "portal.users.manage")}
      canManageRoles={can(session, "portal.roles.manage")}
      viewerId={session?.id || ""}
    />
  );
}
