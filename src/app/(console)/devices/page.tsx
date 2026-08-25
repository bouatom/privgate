import { can, getSession } from "@/lib/auth";
import { headers } from "next/headers";
import { deviceDetail, getDb, listDeviceSummaries, listPolicies } from "@/lib/db";
import { clientBinariesReady, clientMsiAvailable } from "@/lib/client-package";
import { currentClientVersion } from "@/lib/client-version";
import { expireDueJit } from "@/lib/jit-expiry";
import { connectedDeviceIds, uiStatusFor } from "@/lib/realtime/bus";
import { agentOriginFromWebOrigin } from "@/lib/listen";
import { requestOrigin } from "@/lib/origin";
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
  const devices = listDeviceSummaries(db).map((d) => ({
    ...d,
    online: online.has(d.id),
    ...uiStatusFor(d.id, online.has(d.id)),
  }));
  // Drawer selection is URL-driven: no ?id= means no open drawer, a valid id
  // deep-links or survives refresh straight into the slide-over.
  const selected = id && devices.some((d) => d.id === id) ? id : "";
  const detail = selected ? deviceDetail(db, selected) ?? null : null;
  const hdrs = await headers();
  const host = hdrs.get("host") || "localhost:3000";
  const origin = requestOrigin(new Request(`http://${host}/devices`, { headers: hdrs }));

  return (
    <DevicesClient
      devices={devices}
      selected={selected}
      detail={detail}
      canInstall={can(session, "devices.enroll")}
      canManageAllowlists={can(session, "policies.manage")}
      canApproveRequests={can(session, "requests.approve")}
      canUpdate={can(session, "devices.update")}
      currentVersion={currentClientVersion()}
      policies={can(session, "policies.manage") ? listPolicies(db) : []}
      consoleUrl={agentOriginFromWebOrigin(origin)}
      binariesReady={clientBinariesReady()}
      msiReady={clientMsiAvailable()}
    />
  );
}
