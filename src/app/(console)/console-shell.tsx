"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminSession } from "@/lib/models";
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

type NavHref = (typeof nav)[number]["href"];

/** Inline stroke icons per side-nav section; inherit currentColor so amber active state applies. */
const NAV_ICONS: Record<NavHref, React.ReactNode> = {
  "/dashboard": (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  "/requests": (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  "/devices": (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  "/allowlists": (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "/jit": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 1.5" />
    </>
  ),
  "/users": (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  "/configuration": (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

function NavIcon({ href }: { href: NavHref }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[href]}
    </svg>
  );
}

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
  updateBadge,
}: {
  children: React.ReactNode;
  session: AdminSession | null;
  updateBadge?: { version: string; channel: "official" | "nightly" } | null;
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
          {updateBadge ? (
            <Link
              href="/configuration/updates"
              prefetch
              className="update-pill"
              title={`Console update available on the ${updateBadge.channel} channel`}
            >
              Update v{updateBadge.version}
              {updateBadge.channel === "nightly" ? " (nightly)" : ""}
            </Link>
          ) : null}
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
                  "configuration.update",
                  "audit.view",
                ]);
              }
              const need = NAV_PERMISSION[item.href];
              return !need || hasAnyPermission(session?.permissions, [need]);
            })
            .map((item) => {
            const active = item.href === "/dashboard" ? path.startsWith("/dashboard") : path.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} prefetch className={"nav-link" + (active ? " active" : "")}>
                <NavIcon href={item.href} />
                <span>{item.label}</span>
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
