import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { installedConsoleVersionInfo } from "@/lib/console-version";
import { getUpdateChannel } from "@/lib/setup-state";
import { cachedCheck } from "@/lib/self-update-service";
import { currentApplyStatus } from "@/lib/self-update-status";
import { resolveUpdaterScript } from "@/lib/self-update-apply";
import { Forbidden } from "../../forbidden";
import { UpdatesClient } from "./updates-client";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const session = await getSession();
  if (!can(session, "dashboard.view") && !can(session, "configuration.update")) {
    return <Forbidden />;
  }
  const db = getDb();
  const check = cachedCheck();
  const updaterPresent = Boolean(resolveUpdaterScript());

  return (
    <UpdatesClient
      canManage={can(session, "configuration.update")}
      channel={getUpdateChannel(db)}
      installed={installedConsoleVersionInfo()}
      updaterPresent={updaterPresent}
      initialCheck={
        check
          ? {
              available: check.available,
              version: check.version,
              assetName: check.assetName,
              releaseUrl: check.releaseUrl,
              prerelease: check.prerelease,
              checkedAt: check.checkedAt,
              error: check.error,
              channel: check.channel,
            }
          : null
      }
      initialApply={currentApplyStatus()}
    />
  );
}
