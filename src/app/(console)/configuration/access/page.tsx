import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listPortalUsers, listRoles } from "@/lib/portal";
import { Forbidden } from "../../forbidden";
import { AccessClient } from "./access-client";

export default async function AccessPage() {
  const session = await getSession();
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
