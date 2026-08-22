"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Policy } from "@/lib/policy";

type Group = { id: string; name: string; memberCount: number };

export function AllowlistsClient({ rows, groups }: { rows: Policy[]; groups: Group[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    effect: "allow",
    fileHash: "",
    publisher: "",
    fileName: "",
    bindType: "all",
    bindId: "",
  });
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (form.bindType === "group" && !form.bindId) {
      setError("Pick a group for this allow rule.");
      return;
    }
    const res = await fetch("/api/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        childProcesses: "deny",
        bindId: form.bindType === "group" ? form.bindId : "",
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Could not save policy");
      return;
    }
    setForm({ name: "", effect: "allow", fileHash: "", publisher: "", fileName: "", bindType: "all", bindId: "" });
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    await fetch(`/api/policies/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  function bindLabel(row: Policy) {
    if (row.bindType === "group") {
      const group = groups.find((g) => g.id === row.bindId);
      return group ? `Group: ${group.name}` : `Group ${row.bindId}`;
    }
    if (row.bindType === "user") return `User ${row.bindId}`;
    if (row.bindType === "device") return `Device ${row.bindId}`;
    return "Everyone";
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Always-allow programs</h1>
          <p className="lede">These run elevated without an admin password. SHA-256 and publisher are required. Shells cannot be added. Scope a rule to an Entra / AD group after directory sync.</p>
        </div>
      </div>
      <form className="panel stack" onSubmit={onSubmit} style={{ padding: 18, marginBottom: 16 }}>
        <div className="grid cards">
          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label>Publisher</label>
            <input value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} required placeholder="CN=Contoso Code Signing" />
          </div>
          <div>
            <label>SHA-256</label>
            <input value={form.fileHash} onChange={(e) => setForm({ ...form, fileHash: e.target.value })} required />
          </div>
        </div>
        <div className="grid cards">
          <div>
            <label>File name (optional extra check)</label>
            <input value={form.fileName} onChange={(e) => setForm({ ...form, fileName: e.target.value })} placeholder="WidgetSetup.msi" />
          </div>
          <div>
            <label>Who can use it</label>
            <select
              value={form.bindType}
              onChange={(e) => setForm({ ...form, bindType: e.target.value, bindId: e.target.value === "all" ? "" : form.bindId })}
            >
              <option value="all">Everyone</option>
              <option value="group">Security group</option>
            </select>
          </div>
          {form.bindType === "group" ? (
            <div>
              <label>Group</label>
              <select value={form.bindId} onChange={(e) => setForm({ ...form, bindId: e.target.value })} required>
                <option value="">Select a group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.memberCount})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div />
          )}
        </div>
        {error ? <p className="err">{error}</p> : null}
        <button className="primary" type="submit">Add allow rule</button>
      </form>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Policy</th>
              <th>Match</th>
              <th>Scope</th>
              <th>Children</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.name}
                  <div className="mono">{row.effect}</div>
                </td>
                <td>
                  <div>{row.fileName || "any name"}</div>
                  <div className="mono">{row.publisher}</div>
                  <div className="mono">{row.fileHash.slice(0, 20)}…</div>
                </td>
                <td>{bindLabel(row)}</td>
                <td>{row.childProcesses}</td>
                <td>
                  <button className="danger" onClick={() => remove(row.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
