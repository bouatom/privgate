"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminSession } from "@/lib/auth";
import { hasAnyPermission, NAV_PERMISSION } from "@/lib/permissions";
import { SessionContext } from "./session-context";

const nav = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Requests", href: "/requests" },
  { label: "Devices", href: "/devices" },
  { label: "Allowlists", href: "/allowlists" },
  { label: "JIT windows", href: "/jit" },
  { label: "Users", href: "/users" },
  { label: "Configuration", href: "/configuration" },
] as const;

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function railIsHidden(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-rail") === "hidden";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("privgate-theme", theme);
}

function applyRail(hidden: boolean) {
  if (hidden) document.documentElement.setAttribute("data-rail", "hidden");
  else document.documentElement.removeAttribute("data-rail");
  localStorage.setItem("privgate-rail", hidden ? "hidden" : "shown");
}

export function ConsoleShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session: AdminSession | null;
}) {
  const path = usePathname();
  const [theme, setTheme] = useState<Theme>("dark");
  const [railHidden, setRailHidden] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setRailHidden(railIsHidden());
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  function setRail(hidden: boolean) {
    applyRail(hidden);
    setRailHidden(hidden);
  }

  return (
    <SessionContext.Provider value={session}>
    <div className="shell">
      <aside className="rail" id="console-rail">
        <div className="brand-row">
          <div className="brand">
            <div className="mark">PG</div>
            <div>
              <strong>PRIVGATE</strong>
              <span>Hybrid AD elevation</span>
            </div>
          </div>
          <button className="ghost icon-btn" onClick={() => setRail(true)} type="button" aria-controls="console-rail" aria-expanded={!railHidden}>
            Hide
          </button>
        </div>
        <nav>
          {nav
            .filter((item) => {
              if (item.href === "/configuration") {
                return hasAnyPermission(session?.permissions, [
                  "portal.users.manage",
                  "portal.roles.manage",
                  "integrations.view",
                  "integrations.manage",
                  "notifications.view",
                  "notifications.manage",
                  "audit.view",
                ]);
              }
              const need = NAV_PERMISSION[item.href];
              return !need || hasAnyPermission(session?.permissions, [need]);
            })
            .map((item) => {
            const active = item.href === "/dashboard" ? path.startsWith("/dashboard") : path.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} prefetch className={active ? "active" : ""}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button className="ghost" onClick={logout} type="button">
          Sign out
        </button>
      </aside>
      <div className="workspace">
        <header className="chrome">
          <button
            className="ghost icon-btn menu-open"
            onClick={() => setRail(false)}
            type="button"
            aria-controls="console-rail"
            aria-expanded={!railHidden}
          >
            Menu
          </button>
          <div className="chrome-end">
            {session ? (
              <div className="who">
                <strong>{session.name}</strong>
                <span>{session.roles.join(" · ")}</span>
              </div>
            ) : null}
            <button
              className="ghost icon-btn"
              onClick={toggleTheme}
              type="button"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </header>
        <div className="main">{children}</div>
      </div>
    </div>
    </SessionContext.Provider>
  );
}
