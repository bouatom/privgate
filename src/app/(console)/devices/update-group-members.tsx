"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeviceGroupModel } from "@/lib/models";
import type { FleetDevice } from "./fleet-table";

/**
 * Membership editor for one device group: a collapsible member list plus an
 * add-device multiselect (native <select multiple>, no deps). Sends
 * POST/DELETE /api/devices/groups/[id]/members and refreshes the page.
 */

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `request failed (${res.status})`;
}
export function UpdateGroupMembers({ group, devices }: { group: DeviceGroupModel; devices: FleetDevice[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byId = new Map(devices.map((device) => [device.id, device]));
  const members = group.deviceIds
    .map((deviceId) => ({ id: deviceId, hostname: byId.get(deviceId)?.hostname ?? "unknown device" }))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
  const addable = devices.filter((device) => !group.deviceIds.includes(device.id));

  async function addMembers() {
    if (!pendingAdds.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/devices/groups/${encodeURIComponent(group.id)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceIds: pendingAdds }),
      });
      if (!res.ok) {
        setError(await parseError(res));
        return;
      }
      setPendingAdds([]);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(deviceId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/devices/groups/${encodeURIComponent(group.id)}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceIds: [deviceId] }),
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

  return (
    <>
      <div className="group-head" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="ghost icon-btn"
          style={{ color: "var(--muted)" }}
          disabled={busy}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {members.length} device{members.length === 1 ? "" : "s"} {open ? "▴" : "▾"}
        </button>
      </div>
      {open ? (
        <div className="group-members">
          <div className="member-add">
            <select
              multiple
              size={Math.min(Math.max(addable.length, 1), 4)}
              aria-label="Add devices to group"
              value={pendingAdds}
              disabled={busy || !addable.length}
              onChange={(e) => setPendingAdds(Array.from(e.target.selectedOptions).map((o) => o.value))}
            >
              {addable.length ? (
                addable.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.hostname}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  All devices are already in this group
                </option>
              )}
            </select>
            <button
              type="button"
              className="ghost icon-btn"
              disabled={busy || !pendingAdds.length}
              onClick={() => void addMembers()}
            >
              Add selected
            </button>
          </div>
          {members.length ? (
            <ul className="member-list">
              {members.map((member) => (
                <li key={member.id}>
                  <span className="fleet-host">{member.hostname}</span>
                  <button
                    type="button"
                    className="ghost icon-btn"
                    aria-label={`Remove ${member.hostname} from group`}
                    disabled={busy}
                    onClick={() => void removeMember(member.id)}
                  >
                    Remove ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lede" style={{ fontSize: 13 }}>
              No devices in this group yet.
            </p>
          )}
          {error ? (
            <p className="err" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}