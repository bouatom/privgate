import { can, getSession } from "@/lib/auth";
import { headers } from "next/headers";
import { deviceDetail, getDb, listDeviceSummaries, listPolicies } from "@/lib/db";
import { listDeviceGroups } from "@/lib/db/device-groups";
import { clientBinariesReady, clientMsiAvailable } from "@/lib/client-package";
import { currentClientVersion } from "@/lib/client-version";
import { expireDueJit } from "@/lib/jit-expiry";
import { connectedDeviceIds, uiStatusFor } from "@/lib/realtime/bus";
import { agentOriginFromWebOrigin } from "@/lib/listen";
import { requestOrigin } from "@/lib/origin";
import type { DeviceGroupModel } from "@/lib/models";
import { effectiveUpdatePolicy } from "@/lib/update-policy";
import { DevicesClient } from "./devices-client";
import { Forbidden } from "../forbidden";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const session = await getSession();
  if (!can(session, "devices.view") && !can(session, "devices.enroll")) return <Forbidden />;
  const db = getDb();
  expireDueJit();
  const online = new Set(connectedDeviceIds());
  const devices = listDeviceSummaries(db).map((d) => {
    // Server-only resolution stays here: device > highest-priority group > auto.
    const effective = effectiveUpdatePolicy(db, {
      id: d.id,
      updateMode: d.updateMode,
      updateSchedule: d.updateSchedule,
    });
    return {
      ...d,
      online: online.has(d.id),
      ...uiStatusFor(d.id, online.has(d.id)),
      effMode: effective.mode,
      effSchedule: effective.schedule,
      effSource: effective.source,
      effSourceName: effective.sourceName,
    };
  });
  // Drawer selection is URL-driven: no ?id= means no open drawer, a valid id
  // deep-links or survives refresh straight into the slide-over.
  const selected = id && devices.some((d) => d.id === id) ? id : "";
  // deviceDetail() has no policy columns, so fold them onto the detail model
  // from the already-resolved fleet row (same DB, same device).
  const selectedRow = devices.find((d) => d.id === selected);
  const rawDetail = selected ? deviceDetail(db, selected) : undefined;
  const detail =
    selectedRow && rawDetail
      ? {
          ...rawDetail,
          updateMode: selectedRow.updateMode,
          updateSchedule: selectedRow.updateSchedule,
          effMode: selectedRow.effMode,
          effSchedule: selectedRow.effSchedule,
          effSource: selectedRow.effSource,
          effSourceName: selectedRow.effSourceName,
        }
      : null;
  const hdrs = await headers();
  const host = hdrs.get("host") || "localhost:3000";
  const origin = requestOrigin(new Request(`http://${host}/devices`, { headers: hdrs }));
  const canUpdate = can(session, "devices.update");
  const groups: DeviceGroupModel[] = canUpdate ? listDeviceGroups(db) : [];

  return (
    <DevicesClient
      devices={devices}
      selected={selected}
      detail={detail}
      canInstall={can(session, "devices.enroll")}
      canManageAllowlists={can(session, "policies.manage")}
      canApproveRequests={can(session, "requests.approve")}
      canUpdate={canUpdate}
      currentVersion={currentClientVersion()}
      policies={can(session, "policies.manage") ? listPolicies(db) : []}
      groups={groups}
      consoleUrl={agentOriginFromWebOrigin(origin)}
      binariesReady={clientBinariesReady()}
      msiReady={clientMsiAvailable()}
    />
  );
}