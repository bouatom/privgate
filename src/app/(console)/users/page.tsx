import { can, getSession } from "@/lib/auth";
import { getDb, listGroups, listUsers } from "@/lib/db";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const session = await getSession();
  if (!can(session, "directory.users.view") && !can(session, "directory.users.manage")) return <Forbidden />;
  const db = getDb();
  return (
    <UsersClient
      users={presentUsers(listUsers(db))}
      groups={listGroups(db)}
      viewerEmail={session?.email || ""}
      canManage={can(session, "directory.users.manage")}
    />
  );
}
