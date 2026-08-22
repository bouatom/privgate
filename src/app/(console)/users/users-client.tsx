"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PresentedUser } from "@/lib/present";

type Group = { id: string; name: string; directorySource: string; memberCount: number };

export function UsersClient({
  users,
  groups,
  viewerEmail,
  canManage,
}: {
  users: PresentedUser[];
  groups: Group[];
  viewerEmail: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function toggle(user: PresentedUser, field: "jitEligible" | "disabled") {
    if (field === "disabled" && !user.disabled) {
      if (user.userPrincipalName.toLowerCase() === viewerEmail.toLowerCase()) {
        setError("You cannot disable the account you are signed in with.");
        return;
      }
      if (!confirm(`Disable ${user.displayName}? They will be denied elevation until you enable them again.`)) return;
    }
    setError("");
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: !user[field] }),
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
            JIT eligibility and disablement. Connect Entra or Active Directory under{" "}
            <Link href="/configuration/integrations" prefetch>Configuration → Integrations</Link>.
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
              <th>Flags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.length ? (
              users.map((u) => {
                const self = u.userPrincipalName.toLowerCase() === viewerEmail.toLowerCase();
                return (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      <div className="mono">{u.userPrincipalName}</div>
                      <div className="mono">{u.roles.join(", ") || "standard"}</div>
                    </td>
                    <td>
                      <div className="mono">AD {u.adSid || "—"}</div>
                      <div className="mono">Entra {u.entraOid || "—"}</div>
                    </td>
                    <td>
                      {u.jitEligible ? <span className="pill active">JIT</span> : null}{" "}
                      {u.disabled ? <span className="pill denied">disabled</span> : null}
                    </td>
                    <td className="row-actions">
                      {canManage ? (
                        <>
                          <button className="ghost" onClick={() => toggle(u, "jitEligible")}>
                            {u.jitEligible ? "Disallow JIT" : "Allow JIT"}
                          </button>
                          <button className="danger" disabled={self && !u.disabled} onClick={() => toggle(u, "disabled")}>
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                        </>
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
