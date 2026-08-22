"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["Integrations", "/configuration/integrations"],
  ["Notifications", "/configuration/notifications"],
  ["Audit", "/configuration/audit"],
] as const;

export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <div className="config-tabs">
        {items.map(([label, href]) => (
          <Link key={href} href={href} prefetch className={path.startsWith(href) ? "active" : ""}>
            {label}
          </Link>
        ))}
      </div>
      {children}
    </>
  );
}
