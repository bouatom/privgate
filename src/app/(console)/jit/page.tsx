import { getDb, listDeviceSummaries, listJit, listUsers } from "@/lib/db";
import { presentUsers } from "@/lib/present";
import { JitClient } from "./jit-client";

export default function JitPage() {
  const db = getDb();
  return (
    <JitClient
      users={presentUsers(listUsers(db))}
      devices={listDeviceSummaries(db)}
      grants={listJit(db)}
    />
  );
}
