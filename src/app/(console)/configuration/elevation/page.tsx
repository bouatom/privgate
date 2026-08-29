import { can, getSession } from "@/lib/auth";
import { getDb, getElevationSettings } from "@/lib/db";
import { Forbidden } from "../../forbidden";
import { ElevationSettingsClient } from "./elevation-settings-client";

export default async function ElevationSettingsPage() {
  const session = await getSession();
  if (!can(session, "policies.view") && !can(session, "policies.manage")) return <Forbidden />;
  return (
    <ElevationSettingsClient
      initial={getElevationSettings(getDb()).uacMode}
      canManage={can(session, "policies.manage")}
    />
  );
}
