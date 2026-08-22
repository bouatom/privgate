import { can, getSession } from "@/lib/auth";
import { getDb, listDeviceSummaries, listJit, listUsers } from "@/lib/db";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { JitClient } from "./jit-client";

export default async function JitPage() {
  const session = await getSession();
  if (!can(session, "jit.view") && !can(session, "jit.grant")) return <Forbidden />;
  const db = getDb();
  return (
    <JitClient
      users={presentUsers(listUsers(db))}
      devices={listDeviceSummaries(db)}
      grants={listJit(db)}
      canGrant={can(session, "jit.grant")}
      canRevoke={can(session, "jit.revoke")}
    />
  );
}
