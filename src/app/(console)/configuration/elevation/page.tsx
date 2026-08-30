import { redirect } from "next/navigation";

/** Elevation mode lives under Policies, not Settings. */
export default function ElevationSettingsRedirect() {
  redirect("/allowlists?tab=elevation");
}
