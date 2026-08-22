import { getDb, listGroups, listPolicies } from "@/lib/db";
import { AllowlistsClient } from "./allowlists-client";

export default function AllowlistsPage() {
  const db = getDb();
  return <AllowlistsClient rows={listPolicies(db)} groups={listGroups(db)} />;
}
