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
  const { confirm, dialog } = useConfirm();

  function clampMinutes(value: number): number {
    if (!Number.isFinite(value)) return 15;
    return Math.min(60, Math.max(15, Math.round(value)));
  }
  const eligible = users.filter(
    (u) => u.jitEligible && !u.roles.some((role) => role === "Approver" || role === "PolicyAdmin"),
  );
  const selectedGroup = groups.find((g) => g.id === form.groupId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const durationMinutes = clampMinutes(form.durationMinutes);
    const confirmed = await confirm({
      title: selectedGroup
        ? `Open a ${durationMinutes}-minute admin window for group "${selectedGroup.name}"?`
        : `Open a ${durationMinutes}-minute admin window on this device?`,
      body: selectedGroup
        ? `Every one of the ${selectedGroup.memberCount} members of "${selectedGroup.name}" gets local Administrators on this device. The broker will revoke each member even if the API is down.`
        : "The subject gets local Administrators on this device. The broker will revoke it even if the API is down.",
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
    setForm({ ...form, reason: "" });
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
      <div className="top">
        <div>
          <h1>JIT admin windows</h1>
          <p className="lede">Temporary local Administrators membership, 15–60 minutes, one active window per subject and device — target a single user or a whole security group. The broker schedules revoke on the PC at grant time.</p>
        </div>
      </div>
      {canGrant ? (
      <form className="panel stack" onSubmit={onSubmit} style={{ padding: 18, marginBottom: 16 }}>
        <div className="grid cards">
          <div>
            <label>User</label>
            <select
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value, groupId: "" })}
            >
              <option value="">Select…</option>
              {eligible.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>or Group</label>
            <select
              value={form.groupId}
              onChange={(e) => setForm({ ...form, groupId: e.target.value, userId: "" })}
            >
              <option value="">Select…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.memberCount})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Device</label>
            <select value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} required>
              <option value="">Select…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Minutes</label>
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
        <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        {error ? <p className="err">{error}</p> : null}
        {selectedGroup ? (
          <p className="lede" style={{ fontSize: 13 }}>
            Granting to a group covers {selectedGroup.memberCount} member{selectedGroup.memberCount === 1 ? "" : "s"} at
            grant time; later directory changes do not extend or shrink an open window.
          </p>
        ) : null}
        {eligible.length === 0 && groups.length === 0 ? (
          <p className="lede" style={{ fontSize: 13 }}>No JIT-eligible users or synced groups. Allow JIT on Directory users or connect Entra/AD first.</p>
        ) : null}
        <button className="primary" type="submit" disabled={!eligible.length && !groups.length}>Open window</button>
      </form>
      ) : null}
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
      {dialog}
    </>
  );
}
