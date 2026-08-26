"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PresentedUser } from "@/lib/models";
import s from "./users-client.module.css";

type Group = { id: string; name: string; directorySource: string; memberCount: number };

/** AD SID → last segment only, e.g. "S-1-5-21-…-1129" ⇒ "····1129". */
function sidTail(sid: string): string {
  return `····${sid.split("-").pop() ?? sid}`;
}

/** Entra GUID/object-id → last 4 chars, e.g. "····9f2c". */
function oidTail(oid: string): string {
  return `····${oid.slice(-4)}`;
}

export function UsersClient({
  users,
  groups,
  elevatedGroupCount,
  canManage,
}: {
  users: PresentedUser[];
  groups: Group[];
  elevatedGroupCount: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function toggleJit(user: PresentedUser) {
    setError("");
    setPendingId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jitEligible: !user.jitEligible }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Could not update user.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Directory users</h1>
          <p className="lede">
            JIT eligibility and real elevation status, straight from the directory. Connect Entra or Active
            Directory under <Link href="/configuration/integrations" prefetch>Configuration → Identity Sources</Link>.
            This console never creates or disables directory accounts.
          </p>
        </div>
      </div>

      {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}
      <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
        <table className={s.usersTable}>
          <thead>
            <tr>
              <th>User</th>
              <th>Identities</th>
              <th>Status</th>
              <th className={s.switchHeader}>JIT</th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((u) => {
                const busy = pendingId === u.id;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className={s.userName}>{u.displayName}</div>
                      <div className={`${s.userUpn} mono`}>{u.userPrincipalName}</div>
                    </td>
                    <td>
                      <span className={s.identities}>
                        {u.adSid ? (
                          <span className={s.chip} title={u.adSid}>
                            <b>AD</b>
                            {sidTail(u.adSid)}
                          </span>
                        ) : null}
                        {u.entraOid ? (
                          <span className={s.chip} title={u.entraOid}>
                            <b>Entra</b>
                            {oidTail(u.entraOid)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className={s.pills}>
                        {u.effectiveRole === "elevated-admin" ? (
                          <span className="pill denied">elevated admin</span>
                        ) : (
                          <span className="pill active">standard</span>
                        )}
                        {u.accountKind === "service" ? (
                          <span className={`pill ${s.pillMuted}`}>sync/service</span>
                        ) : null}
                        {u.jitEligible ? <span className="pill active">JIT</span> : null}
                      </span>
                    </td>
                    <td className={s.switchCell}>
                      {canManage ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={u.jitEligible}
                          aria-label={`JIT eligibility for ${u.displayName}`}
                          className={`${s.switch} ${u.jitEligible ? s.on : ""}`}
                          disabled={busy}
                          onClick={() => toggleJit(u)}
                        >
                          <span className={s.knob} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className={s.empty}>No directory users yet. Connect Entra ID or Active Directory under Identity Sources.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {groups.length ? (
        <>
          <h1 style={{ fontSize: 20, marginTop: 8 }}>Groups</h1>
          <p className="lede" style={{ fontSize: 13 }}>
            {elevatedGroupCount > 0
              ? `${elevatedGroupCount} group${elevatedGroupCount === 1 ? "" : "s"} confer real elevation (badges above follow directory membership).`
              : "Synced from your directory; membership feeds allowlist binds and elevation badges."}
          </p>
          <div className="panel">
            <table className={s.groupsTable}>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Source</th>
                  <th className={s.numHeader}>Members</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td className={s.srcText}>{g.directorySource}</td>
                    <td className={s.num}>{g.memberCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
