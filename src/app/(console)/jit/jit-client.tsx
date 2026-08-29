"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatWhen } from "@/lib/format";
import type { PresentedUser } from "@/lib/models";
import { useConfirm } from "../_components/confirm-dialog";

type Device = { id: string; hostname: string };
type Group = { id: string; name: string; memberCount: number };
type Grant = {
  id: string;
  status: string;
  durationMinutes: number;
  reason: string;
  expiresAt: string;
  userName: string;
  hostname: string;
  kind: "user" | "group";
  groupName: string;
  memberCount: number;
};

export function JitClient({
  users,
  groups,
  devices,
  grants,
  canGrant,
  canRevoke,
}: {
  users: PresentedUser[];
  groups: Group[];
  devices: Device[];
  grants: Grant[];
  canGrant: boolean;
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    userId: "",
    groupId: "",
    deviceId: "",
    durationMinutes: 15,
    reason: "",
  });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  function clampMinutes(value: number): number {
    if (!Number.isFinite(value)) return 15;
    return Math.min(60, Math.max(15, Math.round(value)));
  }

  const selectedGroup = groups.find((g) => g.id === form.groupId);
  const selectedUser = users.find((u) => u.id === form.userId);
  const selectedDevice = devices.find((d) => d.id === form.deviceId);

  function openDialog() {
    setError("");
    setForm({ userId: "", groupId: "", deviceId: "", durationMinutes: 15, reason: "" });
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setError("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const durationMinutes = clampMinutes(form.durationMinutes);
    const subject = selectedGroup
      ? `group "${selectedGroup.name}" (${selectedGroup.memberCount} members)`
      : selectedUser
        ? `user "${selectedUser.displayName}"`
        : "the selected subject";
    const confirmed = await confirm({
      title: `Open a ${durationMinutes}-minute admin window?`,
      body: `This grants local Administrators on ${selectedDevice?.hostname || "the device"} to ${subject}. The broker will revoke it on schedule.`,
      confirmLabel: "Open window",
    });
    if (!confirmed) return;
    const res = await fetch("/api/jit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, durationMinutes }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Could not grant JIT");
      return;
    }
    closeDialog();
    startTransition(() => router.refresh());
  }

  async function revoke(id: string) {
    const confirmed = await confirm({
      title: "Force revoke this JIT window now?",
      body: "Every covered user loses local Administrators on the next broker tick.",
      confirmLabel: "Revoke now",
      danger: true,
    });
    if (!confirmed) return;
    const res = await fetch(`/api/jit/${id}/revoke`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "Could not revoke JIT");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {/* ── Create button ─────────────────────────────────────────── */}
      {canGrant ? (
        <div className="row-actions" style={{ marginBottom: 16 }}>
          <button className="primary" type="button" onClick={openDialog}>
            Create JIT Window
          </button>
          {users.length === 0 && groups.length === 0 ? (
            <span className="lede" style={{ fontSize: 13 }}>
              No directory users or synced groups yet. Connect Entra or Active Directory first.
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ── Active & recent grants ────────────────────────────────── */}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Who</th>
              <th>Window</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {grants.length ? (
              grants.map((g) => (
                <tr key={g.id}>
                  <td><span className={`pill ${g.status}`}>{g.status}</span></td>
                  <td>
                    {g.kind === "group" ? (
                      <>
                        <span className="pill">{g.groupName}</span>
                        <div className="mono">group · {g.memberCount} member{g.memberCount === 1 ? "" : "s"} at grant time</div>
                      </>
                    ) : (
                      g.userName
                    )}
                    <div className="mono">{g.hostname}</div>
                  </td>
                  <td>
                    {g.durationMinutes} min
                    <div className="mono">{g.reason}</div>
                    <div className="mono">until {formatWhen(g.expiresAt)}</div>
                  </td>
                  <td>
                    {g.status === "active" && canRevoke ? (
                      <button className="danger" onClick={() => revoke(g.id)}>Force revoke</button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="lede" style={{ padding: 18 }}>No JIT windows yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Create JIT Window dialog ──────────────────────────────── */}
      {canGrant && open ? (
        <div className="confirm-overlay" onClick={closeDialog}>
          <dialog
            open
            className="jit-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Create JIT Window"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeDialog(); } }}
          >
            <h2>Create JIT Window</h2>
            <p className="lede" style={{ fontSize: 13, marginBottom: 14 }}>
              Grant temporary local Administrators on a device. The broker revokes access automatically when the window expires.
            </p>
            <form onSubmit={onSubmit}>
              <div className="grid cards" style={{ marginBottom: 12 }}>
                <div>
                  <label>User</label>
                  <select
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value, groupId: "" })}
                  >
                    <option value="">Select a user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>or Security Group</label>
                  <select
                    value={form.groupId}
                    onChange={(e) => setForm({ ...form, groupId: e.target.value, userId: "" })}
                  >
                    <option value="">Select a group…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.memberCount} member{g.memberCount === 1 ? "" : "s"})
                      </option>
                    ))}
                  </select>
                  {groups.length === 0 ? (
                    <div className="lede" style={{ fontSize: 11, marginTop: 4 }}>
                      No synced groups. Connect Entra ID or AD in Settings → Identity Sources.
                    </div>
                  ) : null}
                </div>
                <div>
                  <label>Device</label>
                  <select value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} required>
                    <option value="">Select a device…</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.hostname}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Duration (minutes)</label>
                  <input
                    type="number"
                    min={15}
                    max={60}
                    value={form.durationMinutes}
                    onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                    onBlur={(e) => setForm({ ...form, durationMinutes: clampMinutes(Number(e.target.value)) })}
                  />
                </div>
              </div>
              <label>Reason</label>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                required
                placeholder="e.g. Debugging production issue #1234"
                style={{ marginBottom: 12 }}
              />
              {selectedGroup ? (
                <p className="lede" style={{ fontSize: 12, marginBottom: 12 }}>
                  Granting to a group covers {selectedGroup.memberCount} member{selectedGroup.memberCount === 1 ? "" : "s"} at
                  grant time; later directory changes do not extend or shrink an open window.
                </p>
              ) : null}
              {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}
              <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                <button type="button" onClick={closeDialog}>Cancel</button>
                <button
                  className="primary"
                  type="submit"
                  disabled={!form.userId && !form.groupId}
                >
                  Open window
                </button>
              </div>
            </form>
          </dialog>
        </div>
      ) : null}
      {confirmDialog}
    </>
  );
}
