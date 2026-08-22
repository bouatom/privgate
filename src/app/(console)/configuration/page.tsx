import { getSession } from "@/lib/auth";
import { firstAllowedConfigHref } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function ConfigurationIndex() {
  const session = await getSession();
  redirect(firstAllowedConfigHref(session?.permissions));
}
