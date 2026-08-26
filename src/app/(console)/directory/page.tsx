import { can, getSession } from "@/lib/auth";
import { getDb, listDeviceSummaries, listGroups, listJit, listUsers } from "@/lib/db";
import { expireDueJit } from "@/lib/jit-expiry";
import { presentUsers } from "@/lib/present";
import { Forbidden } from "../forbidden";
import { JitClient } from "../jit/jit-client";

export default async function DirectoryPage() {
  const session = await getSession();
  if (!can(session, "jit.view") && !can(session, "jit.grant")) return <Forbidden />;

  const db = getDb();
  expireDueJit();

  // All directory users are JIT-eligible by policy — present every user with
  // jitEligible: true so the grant dialog shows the full roster.
  const users = presentUsers(listUsers(db)).map((u) => ({ ...u, jitEligible: true }));
  const groups = listGroups(db).filter((g) => g.memberCount > 0);
  const devices = listDeviceSummaries(db);
  const grants = listJit(db);

  return (
    <>
      <div className="top">
        <div>
          <h1>JIT Access</h1>
          <p className="lede">
            Temporary local Administrators windows that the broker revokes on
            schedule. Every directory user is eligible for JIT access.
          </p>
        </div>
      </div>
      <JitClient
        users={users}
        groups={groups}
        devices={devices}
        grants={grants}
        canGrant={can(session, "jit.grant")}
        canRevoke={can(session, "jit.revoke")}
      />
    </>
  );
}
