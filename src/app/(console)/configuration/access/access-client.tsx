"use client";

import React, { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PortalRole, PortalUser } from "@/lib/models";
import { RolesPanel } from "./roles-panel";
import { MIN_PASSWORD_LENGTH, assertClientPassword } from "@/lib/constants";

export function AccessClient({
  users,
  roles,
  canManageUsers,
  canManageRoles,
  viewerId,
}: {
  users: PortalUser[];
  roles: PortalRole[];
  canManageUsers: boolean;
  canManageRoles: boolean;
  viewerId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [userForm, setUserForm] = useState({
    displayName: "",
    email: "",
    kind: "local" as "local" | "sso",
    password: "",
    roleIds: [] as string[],
  });

  // Password change form (for current user)
  const [pwdForm, setPwdForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwdError, setPwdError] = useState("");
  const [pwdMessage, setPwdMessage] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwdError("");
    setPwdMessage("");
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setPwdError("New passwords do not match");
      return;
    }
    const problem = assertClientPassword(pwdForm.newPassword);
    if (problem) {
      setPwdError(problem);
      return;
    }
    setPwdBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pwdForm),
      });
      const body = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setPwdError(body.error || "Could not change password");
        return;
      }
      setPwdMessage("Password changed successfully.");
      setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } finally {
      setPwdBusy(false);
    }
  }

  // Inline role editor for existing users
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRoleIds, setEditingRoleIds] = useState<string[]>([]);

  async function refresh() {
    startTransition(() => router.refresh());
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const res = await fetch("/api/portal/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(userForm),
    });
    const body = (await res.json()) as { error?: string; displayName?: string };
    if (!res.ok) {
      setError(body.error || "Could not create user");
      return;
    }
    setUserForm({ displayName: "", email: "", kind: "local", password: "", roleIds: [] });
    setMessage(`Created portal user ${body.displayName}.`);
    await refresh();
  }

  async function patchUser(id: string, payload: Record<string, unknown>) {
    setError("");
    const res = await fetch(`/api/portal/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error || "Could not update user");
      return;
    }
    await refresh();
  }

  async function saveUserRoles(id: string) {
    setError("");
    setMessage("");
    const res = await fetch(`/api/portal/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleIds: editingRoleIds }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error || "Could not update roles");
      return;
    }
    setMessage("Roles updated.");
    setEditingUserId(null);
    await refresh();
  }

  function openRoleEditor(u: PortalUser) {
    setEditingUserId(u.id);
    setEditingRoleIds(u.roleIds);
  }

  function cancelRoleEditor() {
    setEditingUserId(null);
    setEditingRoleIds([]);
  }

  function toggleUserRole(id: string) {
    setUserForm((prev) => ({
      ...prev,
      roleIds: prev.roleIds.includes(id) ? prev.roleIds.filter((r) => r !== id) : [...prev.roleIds, id],
    }));
  }

  function toggleEditingRole(id: string) {
    setEditingRoleIds((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  }

  return (
    <>
      {message ? <p className="ok" style={{ marginBottom: 12 }}>{message}</p> : null}
      {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}

      {/* ── Portal Users ─────────────────────────────────────────── */}
      <h2 className="section-title">Portal Users</h2>
      <div className="panel" style={{ padding: 0, marginBottom: 24 }}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Roles</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <React.Fragment key={u.id}>
                <tr>
                  <td>
                    {u.displayName}
                    <div className="mono">{u.email}</div>
                    <div className="mono">{u.kind === "sso" ? "SSO (Entra)" : "Local"}{u.passwordSet ? " · password set" : ""}</div>
                  </td>
                  <td>
                    {u.roleNames.map((name) => (
                      <span key={name} className="pill active" style={{ marginRight: 4 }}>{name}</span>
                    ))}
                    {u.disabled ? <span className="pill denied">disabled</span> : null}
                  </td>
                  <td className="row-actions">
                    {canManageUsers ? (
                      <>
                        <button
                          type="button"
                          onClick={() => editingUserId === u.id ? cancelRoleEditor() : openRoleEditor(u)}
                        >
                          {editingUserId === u.id ? "Cancel" : "Edit roles"}
                        </button>
                        {u.id !== viewerId ? (
                          <button
                            className="danger"
                            type="button"
                            onClick={() => void patchUser(u.id, { disabled: !u.disabled })}
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                </tr>
                {editingUserId === u.id && canManageUsers ? (
                  <tr>
                    <td colSpan={3} style={{ background: "var(--surface-2)", padding: 14 }}>
                      <strong style={{ display: "block", marginBottom: 8 }}>Assign roles to {u.displayName}</strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        {roles.map((r) => (
                          <label key={r.id} className="choice" style={{ minWidth: 180 }}>
                            <input
                              type="checkbox"
                              checked={editingRoleIds.includes(r.id)}
                              onChange={() => toggleEditingRole(r.id)}
                            />
                            {r.name}
                            <span className="lede" style={{ fontSize: 11, marginLeft: 4 }}>
                              {r.system ? "predefined" : "custom"}
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="row-actions">
                        <button className="primary" type="button" onClick={() => void saveUserRoles(u.id)}>
                          Save roles
                        </button>
                        <button type="button" onClick={cancelRoleEditor}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
            {!users.length ? (
              <tr>
                <td colSpan={3} className="lede" style={{ padding: 18 }}>
                  No portal users yet. Create one below to grant console access.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ── Add Portal User ─────────────────────────────────────── */}
      {canManageUsers ? (
        <>
          <h2 className="section-title">Add Portal User</h2>
          <form className="panel stack" style={{ padding: 18, marginBottom: 24 }} onSubmit={createUser}>
            <div className="grid cards">
              <div>
                <label>Display name</label>
                <input value={userForm.displayName} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} required />
              </div>
              <div>
                <label>Email / UPN</label>
                <input value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required placeholder="ops@contoso.test" />
              </div>
              <div>
                <label>Sign-in</label>
                <select value={userForm.kind} onChange={(e) => setUserForm({ ...userForm, kind: e.target.value as "local" | "sso", password: "" })}>
                  <option value="local">Local user (password)</option>
                  <option value="sso">Single sign-on (Entra ID)</option>
                </select>
              </div>
              {userForm.kind === "local" ? (
                <div>
                  <label>Password</label>
                  <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} autoComplete="new-password" />
                </div>
              ) : (
                <div className="lede" style={{ fontSize: 12, alignSelf: "end" }}>
                  They must sign in with Entra ID. Create them before their first SSO login.
                </div>
              )}
            </div>
            <label>Roles</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {roles.map((r) => (
                <label key={r.id} className="choice">
                  <input type="checkbox" checked={userForm.roleIds.includes(r.id)} onChange={() => toggleUserRole(r.id)} />
                  {r.name}
                  <span className="lede" style={{ fontSize: 12, marginLeft: 4 }}>{r.system ? "predefined" : "custom"}</span>
                </label>
              ))}
            </div>
<button className="primary" type="submit">Create user</button>
            </form>
          </>
        ) : null}

      {/* ── Change Password (current user) ─────────────────────────── */}
      <h2 className="section-title">Change Password</h2>
      <form className="panel stack" style={{ padding: 18, marginBottom: 24 }} onSubmit={changePassword}>
        <p className="lede" style={{ fontSize: 12, marginBottom: 12 }}>
          Change your local console password. Must be at least {MIN_PASSWORD_LENGTH} characters.
        </p>
        <div className="grid cards" style={{ gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Current password</label>
            <input
              type="password"
              value={pwdForm.currentPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
              autoComplete="current-password"
              required
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>New password</label>
            <input
              type="password"
              value={pwdForm.newPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              autoComplete="new-password"
              required
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Confirm new password</label>
            <input
              type="password"
              value={pwdForm.confirmPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
              autoComplete="new-password"
              required
            />
          </div>
        </div>
        {pwdError ? <p className="err" style={{ marginBottom: 8 }}>{pwdError}</p> : null}
        {pwdMessage ? <p className="ok" style={{ marginBottom: 8 }}>{pwdMessage}</p> : null}
        <button className="primary" type="submit" disabled={pwdBusy}>
          {pwdBusy ? "Changing…" : "Change password"}
        </button>
      </form>

      {/* ── Roles (extracted component) ──────────────────────────── */}
      <RolesPanel roles={roles} canManageRoles={canManageRoles} />
    </>
  );
}
