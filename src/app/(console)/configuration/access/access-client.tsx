"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PERMISSIONS, type PermissionId } from "@/lib/permissions";
import type { PortalRole, PortalUser } from "@/lib/models";

const groups = [...new Set(PERMISSIONS.map((p) => p.group))];

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
  const [selectedRole, setSelectedRole] = useState(roles[0]?.id || "");
  const [userForm, setUserForm] = useState({
    displayName: "",
    email: "",
    kind: "local" as "local" | "sso",
    password: "",
    roleIds: [] as string[],
  });
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customPerms, setCustomPerms] = useState<PermissionId[]>([]);
  const [editPerms, setEditPerms] = useState<PermissionId[]>([]);

  // Inline role editor for existing users
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRoleIds, setEditingRoleIds] = useState<string[]>([]);

  const role = roles.find((r) => r.id === selectedRole);
  const editing = role && !role.system;

  useEffect(() => {
    if (role) setEditPerms(role.permissions);
  }, [role]);

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

  async function createRole(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/portal/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: customName, description: customDescription, permissions: customPerms }),
    });
    const body = (await res.json()) as { error?: string; id?: string };
    if (!res.ok) {
      setError(body.error || "Could not create role");
      return;
    }
    setCustomName("");
    setCustomDescription("");
    setCustomPerms([]);
    if (body.id) setSelectedRole(body.id);
    setMessage("Custom role saved.");
    await refresh();
  }

  async function saveRolePerms() {
    if (!role || role.system) return;
    setError("");
    const res = await fetch(`/api/portal/roles/${role.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissions: editPerms }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error || "Could not update role");
      return;
    }
    setMessage("Role permissions saved.");
    await refresh();
  }

  async function removeRole() {
    if (!role || role.system) return;
    if (!confirm(`Delete role "${role.name}"?`)) return;
    const res = await fetch(`/api/portal/roles/${role.id}`, { method: "DELETE" });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error || "Could not delete role");
      return;
    }
    setSelectedRole(roles.find((r) => r.id !== role.id)?.id || "");
    await refresh();
  }

  function togglePerm(list: PermissionId[], id: PermissionId, set: (next: PermissionId[]) => void) {
    set(list.includes(id) ? list.filter((p) => p !== id) : [...list, id]);
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
      <div className="top">
        <div>
          <h1>Users &amp; permissions</h1>
          <p className="lede">
            Portal operators are separate from directory identities on Users. Create a local account with a password,
            or an SSO account that signs in with Entra ID. Assign a predefined role or a custom permission set.
          </p>
        </div>
      </div>
      {message ? <p className="ok" style={{ marginBottom: 12 }}>{message}</p> : null}
      {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}

      <div className="device-layout" style={{ marginBottom: 24 }}>
        <div>
          <h2 className="section-title">Portal users</h2>
          <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
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
                  <>
                    <tr key={u.id}>
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
                      <tr key={`${u.id}-edit`}>
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          {canManageUsers ? (
            <form className="panel stack" style={{ padding: 18 }} onSubmit={createUser}>
              <strong>Add portal user</strong>
              <label>Display name</label>
              <input value={userForm.displayName} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} required />
              <label>Email / UPN</label>
              <input value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required placeholder="ops@contoso.test" />
              <label>Sign-in</label>
              <select value={userForm.kind} onChange={(e) => setUserForm({ ...userForm, kind: e.target.value as "local" | "sso", password: "" })}>
                <option value="local">Local user (password)</option>
                <option value="sso">Single sign-on (Entra ID)</option>
              </select>
              {userForm.kind === "local" ? (
                <>
                  <label>Password</label>
                  <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} autoComplete="new-password" />
                </>
              ) : (
                <p className="lede" style={{ fontSize: 12 }}>They must sign in with Entra ID. Create them before their first SSO login.</p>
              )}
              <label>Roles</label>
              {roles.map((r) => (
                <label key={r.id} className="choice">
                  <input type="checkbox" checked={userForm.roleIds.includes(r.id)} onChange={() => toggleUserRole(r.id)} />
                  {r.name}
                  <span className="lede" style={{ fontSize: 12, marginLeft: 4 }}>{r.system ? "predefined" : "custom"}</span>
                </label>
              ))}
              <button className="primary" type="submit">Create user</button>
            </form>
          ) : (
            <p className="lede">You can view roles but not create portal users.</p>
          )}
        </div>
      </div>

      <h2 className="section-title">Roles</h2>
      <div className="device-layout">
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr
                  key={r.id}
                  className={r.id === selectedRole ? "device-row selected" : "device-row"}
                  onClick={() => setSelectedRole(r.id)}
                >
                  <td>
                    {r.name}
                    <div className="mono">{r.system ? "Predefined" : "Custom"} · {r.permissions.length} permissions</div>
                    <div className="lede" style={{ fontSize: 12, maxWidth: "36ch" }}>{r.description}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          {role ? (
            <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
              <strong>{role.name}</strong>
              <p className="lede" style={{ fontSize: 13 }}>{role.description}</p>
              {groups.map((group) => (
                <div key={group}>
                  <label>{group}</label>
                  {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                    <label key={p.id} className="choice">
                      <input
                        type="checkbox"
                        checked={(editing ? editPerms : role.permissions).includes(p.id)}
                        disabled={!editing || !canManageRoles}
                        onChange={() => togglePerm(editPerms, p.id, setEditPerms)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              ))}
              {editing && canManageRoles ? (
                <div className="row-actions">
                  <button className="primary" type="button" onClick={() => void saveRolePerms()}>Save permissions</button>
                  <button className="danger" type="button" onClick={() => void removeRole()}>Delete role</button>
                </div>
              ) : (
                <p className="lede" style={{ fontSize: 12 }}>Predefined roles cannot be edited. Duplicate the permission set in a custom role if you need a variant.</p>
              )}
            </div>
          ) : null}

          {canManageRoles ? (
            <form className="panel stack" style={{ padding: 18 }} onSubmit={createRole}>
              <strong>New custom role</strong>
              <label>Name</label>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} required placeholder="Helpdesk approver" />
              <label>Description</label>
              <input value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} />
              {groups.map((group) => (
                <div key={group}>
                  <label>{group}</label>
                  {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                    <label key={p.id} className="choice">
                      <input type="checkbox" checked={customPerms.includes(p.id)} onChange={() => togglePerm(customPerms, p.id, setCustomPerms)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              ))}
              <button className="primary" type="submit">Create role</button>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
