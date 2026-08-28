"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Policy } from "@/lib/policy";
import type { DeviceGroupModel } from "@/lib/models";
import { DeviceDetail, type DeviceDetailModel } from "./device-detail";
import { DeviceDrawer } from "./device-drawer";
import { DeployToggle } from "./deploy-toggle";
import { FleetTable, type FleetDevice } from "./fleet-table";
import { UpdateGroupsPanel } from "./update-groups-panel";

type BulkSummary = {
  pushed: number;
  queued?: Array<{ deviceId: string; version: string }>;
  skipped?: Array<{ deviceId: string; reason: string }>;
};

/**
 * Devices page shell: a compact deploy bar, the dense fleet table with inline
 * status pills, and the URL-driven (?id=) slide-over holding the device
 * detail. Selection lives in the URL so refresh and deep links re-open the
 * drawer.
 */
export function DevicesClient({
  devices,
  selected,
  detail,
  canInstall,
  canManageAllowlists,
  canApproveRequests,
  canUpdate,
  currentVersion,
  policies,
  groups,
  consoleUrl,
  binariesReady,
  msiReady,
}: {
  devices: FleetDevice[];
  selected: string;
  detail: DeviceDetailModel | null;
  canInstall: boolean;
  canManageAllowlists: boolean;
  canApproveRequests: boolean;
  canUpdate: boolean;
  currentVersion: string;
  policies: Policy[];
  groups: DeviceGroupModel[];
  consoleUrl: string;
  binariesReady: boolean;
  msiReady: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [updateError, setUpdateError] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState("");

  function selectDevice(id: string) {
    startTransition(() => router.push(`/devices?id=${encodeURIComponent(id)}`));
  }

  function closeDrawer() {
    startTransition(() => router.push("/devices"));
  }

  async function pushUpdate(deviceId: string, hostname: string) {
    setUpdateError("");
    setBulkMessage("");
    setUpdatingId(deviceId);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/update`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setUpdateError(`${hostname}: ${body.error || `update failed (${res.status})`}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { queued?: boolean };
      if (body.queued) setBulkMessage(`${hostname} is offline — update queued for its next check-in.`);
      startTransition(() => router.refresh());
    } finally {
      setUpdatingId("");
    }
  }

  async function pushAllStale() {
    setUpdateError("");
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
        setUpdateError(body.error || `bulk update failed (${res.status})`);
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

  return (
    <>
      <div className="top">
        <div>
          <h1>Devices</h1>
          <p className="lede">
            Install the Windows client. Each PC registers itself and shows up here as its hostname. Select a row for
            elevation history, events, and JIT windows.
          </p>
        </div>
      </div>

      <DeployToggle canInstall={canInstall} msiReady={msiReady} binariesReady={binariesReady} consoleUrl={consoleUrl} />

      {canUpdate ? (
        <div className="row-actions" style={{ margin: "0 0 8px" }}>
          <button className="ghost icon-btn" type="button" disabled={bulkBusy} onClick={() => void pushAllStale()}>
            {bulkBusy ? "Pushing…" : "Update all stale"}
          </button>
          {bulkMessage ? <span className="lede">{bulkMessage}</span> : null}
          {updateError ? <span className="err">{updateError}</span> : null}
        </div>
      ) : null}

      {canUpdate ? <UpdateGroupsPanel groups={groups} devices={devices} /> : null}

      <div className="panel" style={{ padding: 0 }}>
        <FleetTable
          devices={devices}
          selectedId={selected}
          onSelect={selectDevice}
          canUpdate={canUpdate}
          onUpdateOne={(deviceId, hostname) => void pushUpdate(deviceId, hostname)}
          updatingId={updatingId}
          currentVersion={currentVersion}
        />
      </div>

      <DeviceDrawer open={Boolean(detail)} label={detail?.hostname || ""} onClose={closeDrawer}>
        {detail ? (
          <DeviceDetail
            detail={detail}
            policies={policies}
            canManageAllowlists={canManageAllowlists}
            canApproveRequests={canApproveRequests}
            canUpdate={canUpdate}
          />
        ) : (
          <p className="lede">Loading this computer&apos;s details…</p>
        )}
      </DeviceDrawer>
    </>
  );
}
