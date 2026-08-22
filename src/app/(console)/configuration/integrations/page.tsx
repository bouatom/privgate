import { getAdSettings, getDb } from "@/lib/db";
import { publicDirectoryStatus } from "@/lib/entra";
import { IntegrationsClient } from "./integrations-client";

export default function IntegrationsPage() {
  const db = getDb();
  return <IntegrationsClient directory={publicDirectoryStatus(db)} ad={getAdSettings(db)} />;
}
