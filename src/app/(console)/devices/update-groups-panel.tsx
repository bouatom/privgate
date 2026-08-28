"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeviceGroupModel } from "@/lib/models";
import type { FleetDevice } from "./fleet-table";
import { UpdateGroupCard } from "./update-group-card";

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `request failed (${res.status})`;
}

/**
 * Device-group management for update policies (admins with devices.update).
 * One panel above the fleet table: create groups; the per-group editors live
 * in update-group-card.tsx. Every mutation goes through the existing
 * /api/devices/groups* endpoints and the page re-renders via
 * router.refresh() so the effective-policy pills in the fleet stay truthful.
 */
export function UpdateGroupsPanel({ groups, devices }: { groups: DeviceGroupModel[]; devices: FleetDevice[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function createGroup() {
    const name = newName.trim();
    if (!name) {
      setError("Enter a group name.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/devices/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      setNewName("");
      startTransition(() => router.refresh());
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 14, marginBottom: 16 }} aria-label="Update groups">
      <div className="group-create">
        <div>
          <h2 className="section-title" style={{ marginBottom: 2 }}>
            Device groups
          </h2>
          <p className="lede" style={{ fontSize: 13 }}>
            Set an update policy per group. Effective policy resolves device → highest-priority group → automatic.
          </p>
        </div>
        <div className="group-create-row">
          <input
            type="text"
            placeholder="New group name…"
            aria-label="New group name"
            value={newName}
            disabled={creating}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createGroup();
            }}
          />
          <button type="button" className="primary" disabled={creating} onClick={() => void createGroup()}>
            {creating ? "Creating…" : "New group"}
          </button>
        </div>
      </div>
      {error ? (
        <p className="err" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      ) : null}
      {groups.length ? (
        <div className="group-list">
          {groups.map((group) => (
            <UpdateGroupCard key={group.id} group={group} devices={devices} />
          ))}
        </div>
      ) : (
        <p className="lede" style={{ fontSize: 13, marginTop: 10 }}>
          No device groups yet — create one to roll out a shared update policy.
        </p>
      )}
    </section>
  );
}