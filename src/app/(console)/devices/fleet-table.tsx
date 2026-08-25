"use client";

import { formatWhenShort } from "@/lib/format";
import { updateStateFor } from "./device-update-state";

export type FleetDevice = {
  id: string;
  hostname: string;
  pendingRequests: number;
  activeJit: number;
  lastSeenAt: string | null;
  updateRequestedAt: string | null;
  agentVersion: string;
  online: boolean;
  uiAlive: boolean | null;
  uiLastSeenAt: string | null;
};

function lastSeenLabel(device: FleetDevice): string {
  if (device.online) return "connected now";
  if (!device.lastSeenAt) return "never seen";
  return `last seen ${formatWhenShort(device.lastSeenAt)}`;
}

function uiPillTitle(device: FleetDevice): string | undefined {
  if (device.uiAlive !== false) return undefined;
  // The service can be connected while the tray is dead — that is exactly
  // the state where UAC escapes go unnoticed, so surface when it went quiet.
  return device.uiLastSeenAt
    ? `Client UI heartbeat stopped ${formatWhenShort(device.uiLastSeenAt)}`
    : "No client UI heartbeat has arrived yet";
}

/**
 * Dense one-row-per-device fleet table. Selection is owned by the parent
 * (URL-driven ?id=); Update buttons keep their per-row semantics.
 */
export function FleetTable({
  devices,
  selectedId,
  onSelect,
  canUpdate,
  onUpdateOne,
  updatingId,
  currentVersion,
}: {
  devices: FleetDevice[];
  selectedId: string;
  onSelect: (id: string) => void;
  canUpdate: boolean;
  onUpdateOne: (deviceId: string, hostname: string) => void;
  updatingId: string;
  currentVersion: string;
}) {
  return (
    <table className="fleet">
      <thead>
        <tr>
          <th>Hostname</th>
          <th>Status</th>
          <th>Agent</th>
          <th>Pending</th>
          <th>JIT</th>
          <th>Last seen</th>
        </tr>
      </thead>
      <tbody>
        {devices.length ? (
          devices.map((d) => {
            const state = updateStateFor(d, currentVersion);
            const selected = d.id === selectedId;
            return (
              <tr
                key={d.id}
                className={selected ? "device-row selected" : "device-row"}
                onClick={() => onSelect(d.id)}
              >
                <td>
                  <button
                    type="button"
                    className="fleet-host"
                    aria-pressed={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(d.id);
                    }}
                  >
                    {d.hostname}
                  </button>
                </td>
                <td>
                  {d.online ? <span className="pill active">live</span> : <span className="pill">offline</span>}{" "}
                  {/* GUI liveness: the service can be connected while
                      the tray is dead — that is exactly the state where
                      UAC escapes go unnoticed. */}
                  {d.uiAlive === true ? (
                    <span className="pill active">UI running</span>
                  ) : d.uiAlive === false ? (
                    <span className="pill pending" title={uiPillTitle(d)}>
                      UI silent
                    </span>
                  ) : null}
                </td>
                <td>
                  <span className={`pill ${state.tone}`}>{state.label}</span>
                  {canUpdate && state.kind === "stale" ? (
                    <button
                      type="button"
                      className="ghost icon-btn"
                      disabled={updatingId === d.id}
                      style={{ marginLeft: 6 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateOne(d.id, d.hostname);
                      }}
                    >
                      {updatingId === d.id ? "Pushing…" : "Update"}
                    </button>
                  ) : null}
                </td>
                <td>
                  {d.pendingRequests ? (
                    <span className="pill pending">{d.pendingRequests} pending</span>
                  ) : (
                    <span className="mono">—</span>
                  )}
                </td>
                <td>{d.activeJit ? <span className="pill active">JIT</span> : <span className="mono">—</span>}</td>
                <td className="mono">{lastSeenLabel(d)}</td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={6} className="lede" style={{ padding: 18 }}>
              No clients yet. After you install the MSI or script, the computer appears here as its hostname.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
