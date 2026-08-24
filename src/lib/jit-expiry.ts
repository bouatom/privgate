import "server-only";
import { getDb } from "./db";
import { expireDueGrants } from "./db/jit";
import type { JitGrant } from "./db/types";
import { getUser } from "./db/users";
import { appendAudit } from "./db/audit";
import { deviceIsConnected, publishConsole, publishDevice } from "./realtime/bus";

/// Server-side truth sweep: expires due JIT grants, tells connected agents to
/// revoke local admin (covers missed schtasks / asleep machines), and audits.
export function expireDueJit(): JitGrant[] {
  const db = getDb();
  const expired = expireDueGrants(db);
  if (expired.length === 0) return [];
  publishConsole("jit");
  publishConsole("devices");
  for (const grant of expired) {
    const user = getUser(db, grant.userId);
    appendAudit(db, "system", "jit.expired", grant.deviceId, {
      grantId: grant.id,
      userSid: user?.adSid || "",
    });
    if (deviceIsConnected(grant.deviceId)) {
      publishDevice(grant.deviceId, {
        type: "jit-revoke",
        grantId: grant.id,
        userSid: user?.adSid || "",
      });
    }
  }
  return expired;
}
