import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ConsoleShell } from "./console-shell";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Database-backed check: middleware only validated the cookie signature, so a
  // disabled or de-permissioned portal user can still arrive here with a live JWT.
  const session = await getSession();
  if (!session) redirect("/login");
  return <ConsoleShell session={session}>{children}</ConsoleShell>;
}
