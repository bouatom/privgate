import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { portalNeedsSetup } from "@/lib/portal";
import { wizardPending } from "@/lib/setup-state";
import { updateBadge } from "@/lib/self-update-service";
import { ConsoleShell } from "./console-shell";
import { LiveRefresh } from "./live-refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const needsAdmin = portalNeedsSetup(db);
  if (wizardPending(db, needsAdmin)) redirect("/setup");
  // Database-backed check: middleware only validated the cookie signature, so a
  // disabled or de-permissioned portal user can still arrive here with a live JWT.
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <>
      <LiveRefresh />
      <ConsoleShell session={session} updateBadge={updateBadge()}>
        {children}
      </ConsoleShell>
    </>
  );
}
