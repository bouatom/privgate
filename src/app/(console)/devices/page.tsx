import { deviceDetail, getDb, listDeviceSummaries } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { DevicesClient } from "./devices-client";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const session = await getSession();
  const db = getDb();
  const devices = listDeviceSummaries(db);
  const selected = devices.some((d) => d.id === id) ? id! : devices[0]?.id || "";
  const detail = selected ? deviceDetail(db, selected) ?? null : null;

  return (
    <DevicesClient
      devices={devices}
      selected={selected}
      detail={detail}
      canInstall={Boolean(session?.roles.includes("PolicyAdmin"))}
    />
  );
}
