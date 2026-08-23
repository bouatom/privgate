import { NextResponse } from "next/server";
import { entraSsoAvailable, localLoginOffered } from "@/lib/auth-mode";
import { getDb, getDirectorySettings } from "@/lib/db";
import { portalNeedsSetup } from "@/lib/portal";
import { isWizardCompleted } from "@/lib/setup-state";

export async function GET() {
  const db = getDb();
  const entra = entraSsoAvailable(getDirectorySettings(db));
  return NextResponse.json({
    setup: portalNeedsSetup(db),
    wizard: !isWizardCompleted(db),
    local: localLoginOffered(entra),
    entra,
  });
}
