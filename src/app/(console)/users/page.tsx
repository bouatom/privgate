import { getDb, listGroups, listUsers } from "@/lib/db";
import { presentUsers } from "@/lib/present";
import { UsersClient } from "./users-client";

export default function UsersPage() {
  const db = getDb();
  return <UsersClient users={presentUsers(listUsers(db))} groups={listGroups(db)} />;
}
