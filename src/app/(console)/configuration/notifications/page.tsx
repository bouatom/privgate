import { getDb, getNotificationSettings } from "@/lib/db";
import { NotificationsClient } from "./notifications-client";

export default function NotificationsPage() {
  return <NotificationsClient initial={getNotificationSettings(getDb())} />;
}
