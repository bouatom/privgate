"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PresentedUser } from "@/lib/models";

type Group = { id: string; name: string; directorySource: string; memberCount: number };

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

  async function toggleJit(user: PresentedUser) {
    setError("");
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
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Directory users</h1>
          <p className="lede">
            JIT eligibility and real elevation status, straight from the directory. Connect Entra or Active
            Directory under <Link href="/configuration/integrations" prefetch>Configuration → Integrations</Link>.
            This console never creates or disables directory accounts.
          </p>
        </div>
      </div>

      {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}
      <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Identities</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((u) => {
                return (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      <div className="mono">{u.userPrincipalName}</div>
                    </td>
                    <td>
                      <div className="mono">AD {u.adSid || "—"}</div>
                      <div className="mono">Entra {u.entraOid || "—"}</div>
                    </td>
                    <td>
                      {u.effectiveRole === "elevated-admin" ? (
                        <span className="pill denied">elevated admin</span>
                      ) : (
                        <span className="pill active">standard</span>
                      )}{" "}
                      {u.accountKind === "service" ? <span className="pill">sync/service</span> : null}{" "}
                      {u.jitEligible ? <span className="pill active">JIT</span> : null}
                    </td>
                    <td className="row-actions">
                      {canManage ? (
                        <button className="ghost" onClick={() => toggleJit(u)}>
                          {u.jitEligible ? "Disallow JIT" : "Allow JIT"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="lede" style={{ padding: 18 }}>No directory users yet. Connect Entra or import JSON.</td>
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
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Source</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td className="mono">{g.directorySource}</td>
                    <td>{g.memberCount}</td>
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
