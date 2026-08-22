import { can, getSession } from "@/lib/auth";
import { getDb, getNotificationSettings } from "@/lib/db";
import { Forbidden } from "../../forbidden";
import { NotificationsClient } from "./notifications-client";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!can(session, "notifications.view") && !can(session, "notifications.manage")) return <Forbidden />;
  return <NotificationsClient initial={getNotificationSettings(getDb())} />;
}
