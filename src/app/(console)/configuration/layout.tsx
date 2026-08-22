"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../session-context";
import { CONFIG_TABS, hasAnyPermission } from "@/lib/permissions";

export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const session = useSession();
  const tabs = CONFIG_TABS.filter((item) => hasAnyPermission(session?.permissions, item.anyOf));

  return (
    <>
      <div className="config-tabs">
        {tabs.map((item) => (
          <Link key={item.href} href={item.href} prefetch className={path.startsWith(item.href) ? "active" : ""}>
            {item.label}
          </Link>
        ))}
      </div>
      {children}
    </>
  );
}
