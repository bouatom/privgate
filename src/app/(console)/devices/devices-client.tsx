"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Policy } from "@/lib/policy";
import { formatWhenShort } from "@/lib/format";
import { DeviceDetail, type DeviceDetailModel } from "./device-detail";
import { DeployPanel } from "./deploy-panel";
import type { Method } from "./device-methods";

type DeviceSummary = {
  id: string;
  hostname: string;
  enrolledAt: string;
  pendingRequests: number;
  activeJit: number;
  lastEventAt: string | null;
  lastAction: string | null;
  agentVersion: string;
  lastSeenAt: string | null;
  updateRequestedAt: string | null;
  online: boolean;
};

type BulkSummary = {
  pushed: number;
  queued?: Array<{ deviceId: string; version: string }>;
  skipped?: Array<{ deviceId: string; reason: string }>;
};

function isNewer(candidate: string, installed: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/i, "").split(/[-+]/)[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function lastSeenLabel(device: DeviceSummary): string {
  if (device.online) return "connected now";
  if (!device.lastSeenAt) return "never seen";
  return `last seen ${formatWhenShort(device.lastSeenAt)}`;
}

export function DevicesClient({
  devices,
  selected,
  detail,
  canInstall,
  canManageAllowlists,
  canUpdate,
  currentVersion,
  policies,
  consoleUrl,
  binariesReady,
  msiReady,
}: {
  devices: DeviceSummary[];
  selected: string;
  detail: DeviceDetailModel | null;
  canInstall: boolean;
  canManageAllowlists: boolean;
  canUpdate: boolean;
  currentVersion: string;
  policies: Policy[];
  consoleUrl: string;
  binariesReady: boolean;
  msiReady: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [method, setMethod] = useState<Method>(msiReady ? "msi" : "script");
  const [error, setError] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [updating, setUpdating] = useState("");

  const selectedDevice = useMemo(() => devices.find((d) => d.id === selected), [devices, selected]);

  function selectDevice(id: string) {
    startTransition(() => router.push(`/devices?id=${encodeURIComponent(id)}`));
  }

  async function pushUpdate(deviceId: string, hostname: string) {
    setError("");
    setBulkMessage("");
    setUpdating(deviceId);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/update`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`${hostname}: ${body.error || `update failed (${res.status})`}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { queued?: boolean };
      if (body.queued) setBulkMessage(`${hostname} is offline — update queued for its next check-in.`);
      startTransition(() => router.refresh());
    } finally {
      setUpdating("");
    }
  }

  async function pushAllStale() {
    setError("");
    setBulkMessage("");
    setBulkBusy(true);
    try {
      const res = await fetch("/api/devices/update-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allStale: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `bulk update failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as BulkSummary;
      const parts = [`${body.pushed} pushed`];
      if (body.queued?.length) parts.push(`${body.queued.length} queued`);
      if (body.skipped?.length) parts.push(`${body.skipped.length} skipped`);
      setBulkMessage(parts.join(", "));
      startTransition(() => router.refresh());
    } finally {
      setBulkBusy(false);
    }
  }

  function download() {
    setError("");
    if (method === "msi" && !msiReady) {
      setError("MSI is not available here. Download the deployment script instead.");
      return;
    }
    if (!binariesReady) {
      setError(
        "This console is missing the Windows client. Reinstall from GitHub Releases, or from a source checkout run bash scripts/smoke-agent-build.sh and restart.",
      );
      return;
    }
    window.location.href = `/api/devices/client?format=${method}&apiBase=${encodeURIComponent(consoleUrl)}`;
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Devices</h1>
          <p className="lede">
            Install the Windows client. Each PC registers itself and shows up here as its hostname.
          </p>
        </div>
      </div>

      <DeployPanel
        method={method}
        onMethod={setMethod}
        canInstall={canInstall}
        msiReady={msiReady}
        consoleUrl={consoleUrl}
        error={error}
        onDownload={download}
      />

      <div className="device-layout">
        <div className="panel" style={{ padding: 0 }}>
          {canUpdate ? (
            <div className="row-actions" style={{ padding: 12 }}>
              <button className="ghost" type="button" disabled={bulkBusy} onClick={() => void pushAllStale()}>
                {bulkBusy ? "Pushing…" : "Update all stale"}
              </button>
              {bulkMessage ? <span className="lede">{bulkMessage}</span> : null}
            </div>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Agent</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {devices.length ? (
                devices.map((d) => {
                  const pending = d.agentVersion.includes("+pending");
                  const failed = !pending && d.agentVersion.includes("+stale");
                  const queued = !pending && Boolean(d.updateRequestedAt);
                  const stale = !pending && !failed && isNewer(currentVersion, d.agentVersion);
                  return (
                    <tr
                      key={d.id}
                      className={d.id === selected ? "device-row selected" : "device-row"}
                      onClick={() => selectDevice(d.id)}
                    >
                      <td>
                        <div>
                          {d.hostname}{" "}
                          {d.online ? <span className="pill active">live</span> : <span className="pill">offline</span>}
                        </div>
                        <div className="mono">{lastSeenLabel(d)}</div>
                      </td>
                      <td>
                        {d.agentVersion ? (
                          <>
                            <span className={`pill ${stale || failed ? "pending" : "active"}`}>
                              {pending
                                ? "updating…"
                                : failed
                                  ? "update failed?"
                                  : queued
                                    ? "update queued"
                                    : stale
                                      ? `v${d.agentVersion} → ${currentVersion}`
                                      : `v${d.agentVersion}`}
                            </span>
                            {canUpdate && stale ? (
                              <button
                                type="button"
                                className="ghost"
                                disabled={updating === d.id}
                                style={{ marginLeft: 6 }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void pushUpdate(d.id, d.hostname);
                                }}
                              >
                                {updating === d.id ? "Pushing…" : "Update"}
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <span className="pill">v unknown</span>
                        )}
                      </td>
                      <td>
                        {d.pendingRequests ? <span className="pill pending">{d.pendingRequests} pending</span> : null}{" "}
                        {d.activeJit ? <span className="pill active">JIT</span> : null}
                        <div className="mono">{d.lastAction || "waiting for this PC"}</div>
                        <div className="mono">{d.lastEventAt ? new Date(d.lastEventAt).toLocaleString() : "—"}</div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="lede" style={{ padding: 18 }}>
                    No clients yet. After you install the MSI or script, the computer appears here as its hostname.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          {detail ? (
            <DeviceDetail
              detail={detail}
              policies={policies}
              canManageAllowlists={canManageAllowlists}
            />
          ) : (
            <div className="panel" style={{ padding: 18 }}>
              <p className="lede">
                {selectedDevice
                  ? `Select ${selectedDevice.hostname} again if detail did not load.`
                  : "Install a client to see that computer here."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
