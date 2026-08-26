"use client";

import { useMemo, useState } from "react";
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
  return device.uiLastSeenAt
    ? `Client UI heartbeat stopped ${formatWhenShort(device.uiLastSeenAt)}`
    : "No client UI heartbeat has arrived yet";
}

type SortKey = "hostname" | "status" | "agent" | "pending" | "jit" | "lastSeen";

function sortValue(d: FleetDevice, key: SortKey): string | number {
  switch (key) {
    case "hostname": return d.hostname.toLowerCase();
    case "status": return d.online ? 0 : 1;
    case "agent": return d.agentVersion;
    case "pending": return d.pendingRequests;
    case "jit": return d.activeJit;
    case "lastSeen": return d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : -1;
  }
}

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="sort-arrow inactive">↕</span>;
  return <span className="sort-arrow">{dir === "asc" ? "↑" : "↓"}</span>;
}

/**
 * Dense one-row-per-device fleet table with column sorting and search.
 * Selection is owned by the parent (URL-driven ?id=).
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
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("hostname");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = q
      ? devices.filter((d) => d.hostname.toLowerCase().includes(q))
      : devices;
    list = [...list].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [devices, search, sortKey, sortDir]);

  return (
    <>
      <div className="fleet-search">
        <input
          type="search"
          placeholder="Search by hostname…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search devices"
        />
      </div>
      <table className="fleet">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggleSort("hostname")}>
              Hostname <SortIndicator active={sortKey === "hostname"} dir={sortDir} />
            </th>
            <th className="sortable" onClick={() => toggleSort("status")}>
              Status <SortIndicator active={sortKey === "status"} dir={sortDir} />
            </th>
            <th className="sortable" onClick={() => toggleSort("agent")}>
              Agent <SortIndicator active={sortKey === "agent"} dir={sortDir} />
            </th>
            <th className="sortable" onClick={() => toggleSort("pending")}>
              Pending <SortIndicator active={sortKey === "pending"} dir={sortDir} />
            </th>
            <th className="sortable" onClick={() => toggleSort("jit")}>
              JIT <SortIndicator active={sortKey === "jit"} dir={sortDir} />
            </th>
            <th className="sortable" onClick={() => toggleSort("lastSeen")}>
              Last seen <SortIndicator active={sortKey === "lastSeen"} dir={sortDir} />
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.length ? (
            filtered.map((d) => {
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
                {search
                  ? `No devices matching "${search}".`
                  : "No clients yet. After you install the MSI or script, the computer appears here as its hostname."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
