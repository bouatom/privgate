"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PresentedUser } from "@/lib/present";

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
}: {
  users: PresentedUser[];
  devices: Device[];
  grants: Grant[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({ userId: "", deviceId: "", durationMinutes: 15, reason: "" });
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
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
    await fetch(`/api/jit/${id}/revoke`, { method: "POST" });
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
      <form className="panel stack" onSubmit={onSubmit} style={{ padding: 18, marginBottom: 16 }}>
        <div className="grid cards">
          <div>
            <label>User</label>
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
              <option value="">Select…</option>
              {users.map((u) => (
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
        <button className="primary" type="submit">Open window</button>
      </form>
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
            {grants.map((g) => (
              <tr key={g.id}>
                <td><span className={`pill ${g.status}`}>{g.status}</span></td>
                <td>
                  {g.userName}
                  <div className="mono">{g.hostname}</div>
                </td>
                <td>
                  {g.durationMinutes} min
                  <div className="mono">{g.reason}</div>
                  <div className="mono">until {g.expiresAt}</div>
                </td>
                <td>
                  {g.status === "active" ? (
                    <button className="danger" onClick={() => revoke(g.id)}>Force revoke</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
