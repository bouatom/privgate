import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { advertisedUrls, listenConfig } from "@/lib/listen";
import { portalNeedsSetup } from "@/lib/portal";
import { isWizardCompleted } from "@/lib/setup-state";
import { SetupClient } from "./setup-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SetupPage() {
  const db = getDb();
  const needsAdmin = portalNeedsSetup(db);
  if (!needsAdmin && isWizardCompleted(db)) {
    const session = await getSession();
    redirect(session ? "/dashboard" : "/login");
  }
  const session = needsAdmin ? null : await getSession();
  const cfg = listenConfig();
  return (
    <SetupClient
      needsAdmin={needsAdmin}
      signedIn={Boolean(session)}
      webPort={cfg.webPort}
      agentPort={cfg.agentPort}
      bind={cfg.bind}
      consoleUrls={advertisedUrls(cfg.webPort, cfg.bind)}
      agentUrls={advertisedUrls(cfg.agentPort, cfg.bind)}
    />
  );
}
