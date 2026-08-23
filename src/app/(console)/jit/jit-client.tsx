"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatWhen } from "@/lib/format";
import type { PresentedUser } from "@/lib/models";

type Device = { id: string; hostname: string };
type Grant = {
  id: string;
  status: string;
  durationMinutes: number;
  reason: string;
  expiresAt: string;
  userName: string;
  hostname: string;
};

export function JitClient({
  users,
  devices,
  grants,
  canGrant,
  canRevoke,
}: {
  users: PresentedUser[];
  devices: Device[];
  grants: Grant[];
  canGrant: boolean;
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({ userId: "", deviceId: "", durationMinutes: 15, reason: "" });
  const [error, setError] = useState("");
  const eligible = users.filter(
    (u) => u.jitEligible && !u.disabled && !u.roles.some((role) => role === "Approver" || role === "PolicyAdmin"),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!confirm(`Open a ${form.durationMinutes}-minute local Administrators window on this device? The broker will revoke it even if the API is down.`)) {
      return;
    }
    const res = await fetch("/api/jit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
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
    if (!confirm("Revoke this JIT window now? The user loses local Administrators on the next broker tick.")) return;
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
          <p className="lede">Temporary local Administrators membership, 15–60 minutes, one active window per user and device. The broker schedules revoke on the PC at grant time.</p>
        </div>
      </div>
      {canGrant ? (
      <form className="panel stack" onSubmit={onSubmit} style={{ padding: 18, marginBottom: 16 }}>
        <div className="grid cards">
          <div>
            <label>User</label>
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
              <option value="">Select…</option>
              {eligible.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
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
            />
          </div>
        </div>
        <label>Reason</label>
        <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        {error ? <p className="err">{error}</p> : null}
        {eligible.length === 0 ? (
          <p className="lede" style={{ fontSize: 13 }}>No JIT-eligible users. Allow JIT on Directory users first.</p>
        ) : null}
        <button className="primary" type="submit" disabled={!eligible.length}>Open window</button>
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
                    {g.userName}
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
    </>
  );
}
