import { redirect } from "next/navigation";
import { entraSsoAvailable, localLoginOffered } from "@/lib/auth-mode";
import { getDb, getDirectorySettings } from "@/lib/db";
import { portalNeedsSetup } from "@/lib/portal";
import { isWizardCompleted } from "@/lib/setup-state";
import { LoginClient } from "./login-client";

export default function LoginPage() {
  const db = getDb();
  if (portalNeedsSetup(db)) redirect("/setup");
  const entra = entraSsoAvailable(getDirectorySettings(db));
  return (
    <LoginClient
      entra={entra}
      local={localLoginOffered(entra)}
      continueSetup={!isWizardCompleted(db)}
    />
  );
}
