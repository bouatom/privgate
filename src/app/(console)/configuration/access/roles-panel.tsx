"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { PERMISSIONS, type PermissionId } from "@/lib/permissions";
import type { PortalRole } from "@/lib/models";
import { useConfirm } from "../../_components/confirm-dialog";

const permGroups = [...new Set(PERMISSIONS.map((p) => p.group))];

function togglePerm(list: PermissionId[], id: PermissionId): PermissionId[] {
  return list.includes(id) ? list.filter((p) => p !== id) : [...list, id];
}

export function RolesPanel({
  roles,
  canManageRoles,
}: {
  roles: PortalRole[];
  canManageRoles: boolean;
}) {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(roles[0]?.id || "");
  const [editPerms, setEditPerms] = useState<PermissionId[]>(roles[0]?.permissions || []);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customPerms, setCustomPerms] = useState<PermissionId[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, dialog } = useConfirm();

  const role = roles.find((r) => r.id === selectedRole);
  const editing = role && !role.system;

  if (role && editing) {
    // Sync editPerms when selection changes (only for non-system roles)
  }

  async function refresh() {
    router.refresh();
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
    const confirmed = await confirm({
      title: `Delete role "${role.name}"?`,
      body: "Users holding only this role lose its permissions immediately.",
      confirmLabel: "Delete role",
      danger: true,
    });
    if (!confirmed) return;
    const res = await fetch(`/api/portal/roles/${role.id}`, { method: "DELETE" });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error || "Could not delete role");
      return;
    }
    setSelectedRole(roles.find((r) => r.id !== role.id)?.id || "");
    await refresh();
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

  return (
    <>
      {message ? <p className="ok" style={{ marginBottom: 12 }}>{message}</p> : null}
      {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}

      <h2 className="section-title">Roles</h2>
      <div className="device-layout" style={{ marginBottom: 24 }}>
        <div>
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
                    onClick={() => {
                      setSelectedRole(r.id);
                      setEditPerms(r.permissions);
                    }}
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
        </div>
        <div>
          {role ? (
            <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
              <strong>{role.name}</strong>
              <p className="lede" style={{ fontSize: 13 }}>{role.description}</p>
              {permGroups.map((group) => (
                <div key={group}>
                  <label>{group}</label>
                  {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                    <label key={p.id} className="choice">
                      <input
                        type="checkbox"
                        checked={(editing ? editPerms : role.permissions).includes(p.id)}
                        disabled={!editing || !canManageRoles}
                        onChange={() => setEditPerms(togglePerm(editPerms, p.id))}
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
              {permGroups.map((group) => (
                <div key={group}>
                  <label>{group}</label>
                  {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                    <label key={p.id} className="choice">
                      <input type="checkbox" checked={customPerms.includes(p.id)} onChange={() => setCustomPerms(togglePerm(customPerms, p.id))} />
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
      {dialog}
    </>
  );
}
