import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { portalNeedsSetup } from "@/lib/portal";
import { wizardPending } from "@/lib/setup-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  const db = getDb();
  if (wizardPending(db, portalNeedsSetup(db))) redirect("/setup");
  redirect("/dashboard");
}
