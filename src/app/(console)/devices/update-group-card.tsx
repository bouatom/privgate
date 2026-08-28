"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeviceGroupModel } from "@/lib/models";
import type { FleetDevice } from "./fleet-table";
import { UpdateGroupMembers } from "./update-group-members";

/**
 * One device-group editor row inside the update-groups panel: edit name and
 * priority and set the group update policy (auto | scheduled | manual).
 * Membership editing lives in update-group-members.tsx. Owns its draft state
 * and re-syncs from the server props after each router.refresh().
 */

export const GROUP_MODE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "scheduled", label: "Scheduled" },
  { value: "manual", label: "Manual" },
] as const;

export function groupPolicyLabel(group: DeviceGroupModel): { pill: string; text: string } {
  if (group.updateMode === "scheduled") return { pill: "active", text: `scheduled daily at ${group.updateSchedule}` };
  if (group.updateMode === "manual") return { pill: "pending", text: "manual only" };
  if (group.updateMode === "auto") return { pill: "active", text: "automatic" };
  return { pill: "canceled", text: "inherit (no policy set)" };
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `request failed (${res.status})`;
}

export function UpdateGroupCard({ group, devices }: { group: DeviceGroupModel; devices: FleetDevice[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(group.name);
  const [priority, setPriority] = useState(String(group.priority));
  const [mode, setMode] = useState(group.updateMode);
  const [schedule, setSchedule] = useState(group.updateSchedule || "02:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setName(group.name);
    setPriority(String(group.priority));
    setMode(group.updateMode);
    setSchedule(group.updateSchedule || "02:00");
    setConfirmingDelete(false);
  }, [group.id, group.name, group.priority, group.updateMode, group.updateSchedule]);

  async function saveMeta() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name cannot be blank.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/devices/groups/${encodeURIComponent(group.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, priority: Number(priority) || 0 }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy() {
    if (!mode) {
      setError("Pick a policy mode first.");
      return;
    }
    if (mode === "scheduled" && !schedule) {
      setError("Pick a maintenance time (HH:MM).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/devices/groups/${encodeURIComponent(group.id)}/policy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "scheduled" ? { mode, schedule } : { mode }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/devices/groups/${encodeURIComponent(group.id)}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const policy = groupPolicyLabel(group);

  return (
    <div className="group-card">
      <div className="group-head">
        <input
          type="text"
          aria-label="Group name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="inline-field" title="Higher priority wins when a device belongs to several groups">
          Priority
          <input
            type="number"
            min={0}
            aria-label="Group priority"
            value={priority}
            disabled={busy}
            onChange={(e) => setPriority(e.target.value)}
          />
        </label>
        <button type="button" className="ghost icon-btn" disabled={busy} onClick={() => void saveMeta()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="spacer" />
        {confirmingDelete ? (
          <>
            <button type="button" className="danger" disabled={busy} onClick={() => void deleteGroup()}>
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button type="button" className="ghost icon-btn" disabled={busy} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="danger icon-btn"
            title="Delete this group and detach its members"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        )}
      </div>

      <div className="group-policy">
        <span className="policy-caption">Update policy</span>
        <span className={`pill ${policy.pill}`}>{policy.text}</span>
        <select value={mode} disabled={busy} onChange={(e) => setMode(e.target.value)} aria-label="Group policy mode">
          {!group.updateMode && !mode ? (
            <option value="" disabled>
              Inherit (unset)
            </option>
          ) : null}
          {GROUP_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {mode === "scheduled" ? (
          <input
            type="time"
            aria-label="Group maintenance window time"
            value={schedule}
            disabled={busy}
            onChange={(e) => setSchedule(e.target.value)}
          />
        ) : null}
        <button
          type="button"
          className="ghost icon-btn"
          disabled={busy || !mode || mode === group.updateMode}
          onClick={() => void savePolicy()}
        >
          {busy ? "Saving…" : "Set policy"}
        </button>
      </div>

      {error ? (
        <p className="err" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      ) : null}

      <UpdateGroupMembers group={group} devices={devices} />
    </div>
  );
}