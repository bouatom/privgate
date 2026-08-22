import { can, getSession } from "@/lib/auth";
import { getAdSettings, getDb } from "@/lib/db";
import { publicDirectoryStatus } from "@/lib/entra";
import { Forbidden } from "../../forbidden";
import { IntegrationsClient } from "./integrations-client";

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!can(session, "integrations.view") && !can(session, "integrations.manage")) return <Forbidden />;
  const db = getDb();
  return <IntegrationsClient directory={publicDirectoryStatus(db)} ad={getAdSettings(db)} />;
}
