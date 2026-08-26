import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listPortalUsers, listRoles } from "@/lib/portal";
import { AccessClient } from "../access/access-client";
import { Forbidden } from "../../forbidden";

export default async function AdminsRolesPage() {
  const session = await getSession();
  if (!can(session, "portal.users.manage") && !can(session, "portal.roles.manage")) {
    return <Forbidden message="Only Master Admins can manage portal users and roles." />;
  }
  const db = getDb();
  return (
    <>
      <div className="top">
        <div>
          <h1>Admins &amp; Roles</h1>
          <p className="lede">
            Portal operators who can sign in to this console. Assign predefined or custom roles
            to control what each admin can see and do.
          </p>
        </div>
      </div>
      <AccessClient
        users={listPortalUsers(db)}
        roles={listRoles(db)}
        canManageUsers={can(session, "portal.users.manage")}
        canManageRoles={can(session, "portal.roles.manage")}
        viewerId={session?.id || ""}
      />
    </>
  );
}
