"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const nav = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Requests", href: "/requests" },
  { label: "Devices", href: "/devices" },
  { label: "Allowlists", href: "/allowlists" },
  { label: "JIT windows", href: "/jit" },
  { label: "Users", href: "/users" },
  {
    label: "Configuration",
    href: "/configuration",
    children: [
      { label: "Integrations", href: "/configuration/integrations" },
      { label: "Notifications", href: "/configuration/notifications" },
      { label: "Audit", href: "/configuration/audit" },
    ],
  },
] as const;

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="mark">PG</div>
          <div>
            <strong>PRIVGATE</strong>
            <span>Hybrid AD elevation</span>
          </div>
        </div>
        <nav>
          {nav.map((item) => {
            const active = item.href === "/dashboard" ? path.startsWith("/dashboard") : path.startsWith(item.href);
            return (
              <div key={item.href}>
                <Link href={"children" in item ? item.children[0].href : item.href} prefetch className={active ? "active" : ""}>
                  {item.label}
                </Link>
                {"children" in item ? (
                  <div className="subnav">
                    {item.children.map((child) => (
                      <Link key={child.href} href={child.href} prefetch className={path.startsWith(child.href) ? "active" : ""}>
                        {child.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <button className="ghost" onClick={logout} type="button">
          Sign out
        </button>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
