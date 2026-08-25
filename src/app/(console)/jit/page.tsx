import { can, getSession } from "@/lib/auth";
import { getDb, listDeviceSummaries, listGroups, listJit, listUsers } from "@/lib/db";
import { expireDueJit } from "@/lib/jit-expiry";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { JitClient } from "./jit-client";

export default async function JitPage() {
  const session = await getSession();
  if (!can(session, "jit.view") && !can(session, "jit.grant")) return <Forbidden />;
  const db = getDb();
  expireDueJit();
  return (
    <JitClient
      users={presentUsers(listUsers(db))}
      groups={listGroups(db).filter((g) => g.memberCount > 0)}
      devices={listDeviceSummaries(db)}
      grants={listJit(db)}
      canGrant={can(session, "jit.grant")}
      canRevoke={can(session, "jit.revoke")}
    />
  );
}
