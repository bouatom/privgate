import "server-only";
import { getDb } from "./db";
import { expireDueGrants, grantIdentities } from "./db/jit";
import type { JitGrant } from "./db/types";
import { appendAudit } from "./db/audit";
import { deviceIsConnected, publishConsole, publishDevice } from "./realtime/bus";

/// Server-side truth sweep: expires due JIT grants, tells connected agents to
/// revoke local admin (covers missed schtasks / asleep machines), and audits.
/// Group grants fan out one jit-revoke per snapshotted member SID; when no
/// member resolves, the group label is pushed instead so devices still clear
/// their JIT state and the audit trail names the group.
export function expireDueJit(): JitGrant[] {
  const db = getDb();
  const expired = expireDueGrants(db);
  if (expired.length === 0) return [];
  publishConsole("jit");
  publishConsole("devices");
  for (const grant of expired) {
    const identities = grantIdentities(db, grant);
    if (grant.groupId) {
      appendAudit(db, "system", "jit.expired", grant.deviceId, {
        grantId: grant.id,
        group: grant.groupId,
        members: identities.length,
        userSids: identities.map((i) => i.adSid).filter((sid) => sid !== ""),
      });
      if (deviceIsConnected(grant.deviceId)) {
        const sids = identities.map((i) => i.adSid).filter((sid) => sid !== "");
        if (sids.length === 0) {
          // Fall back to the group label: devices still clear JIT state and
          // the payload names the group for anyone reading the wire log.
          publishDevice(grant.deviceId, {
            type: "jit-revoke",
            grantId: grant.id,
            userSid: "",
            group: grant.groupId,
          });
        } else {
          for (const sid of sids) {
            publishDevice(grant.deviceId, { type: "jit-revoke", grantId: grant.id, userSid: sid });
          }
        }
      }
      continue;
    }
    const userSid = identities[0]?.adSid || "";
    appendAudit(db, "system", "jit.expired", grant.deviceId, {
      grantId: grant.id,
      userSid,
    });
    if (deviceIsConnected(grant.deviceId)) {
      publishDevice(grant.deviceId, {
        type: "jit-revoke",
        grantId: grant.id,
        userSid,
      });
    }
  }
  return expired;
}
