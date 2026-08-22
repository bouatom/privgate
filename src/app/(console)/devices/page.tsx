import { can, getSession } from "@/lib/auth";
import { headers } from "next/headers";
import { deviceDetail, getDb, listDeviceSummaries } from "@/lib/db";
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
  const devices = listDeviceSummaries(db);
  const selected = devices.some((d) => d.id === id) ? id! : devices[0]?.id || "";
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
      initialApiBase={origin}
    />
  );
}
