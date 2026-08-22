import { getDb, listRequests } from "@/lib/db";
import { RequestsClient } from "./requests-client";

export default function RequestsPage() {
  return <RequestsClient rows={listRequests(getDb())} />;
}
