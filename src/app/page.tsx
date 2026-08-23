import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { portalNeedsSetup } from "@/lib/portal";
import { wizardPending } from "@/lib/setup-state";

export default function Home() {
  const db = getDb();
  if (wizardPending(db, portalNeedsSetup(db))) redirect("/setup");
  redirect("/dashboard");
}
