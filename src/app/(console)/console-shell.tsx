"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { AdminSession } from "@/lib/models";
import { IconSvg, NavIcon } from "./nav-icons";
import { activeNavHref, visibleNavGroups } from "./nav-model";
import { SessionContext } from "./session-context";

type Theme = "light" | "dark";

/* Theme toggle glyphs: sun shows while dark (click switches to light),
   moon shows while light. Same stroke pattern as the nav icons. */
const THEME_ICON: Record<Theme, ReactNode> = {
  dark: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  light: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
};

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
  const path = usePathname() ?? "";
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

  // Permission-gated groups/items; active state is longest-prefix match so
  // /configuration/audit highlights "Audit log", not "Settings".
  const groups = visibleNavGroups(session?.permissions);
  const links = groups.flatMap((group) => group.items);
  const activeHref = activeNavHref(path, links);

  return (
    <SessionContext.Provider value={session}>
    <div className="shell">
      <aside className="rail" id="console-rail">
        <div className="brand-row">
          <div className="brand">
            <div className="mark" title="PrivGate console">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={22} height={22} style={{ display: "block" }}>
                <rect width="64" height="64" rx="14" fill="#101218"/>
                <path d="M32 9l19 7.2V30c0 12.6-8.3 20-19 24.5C21.3 50 13 42.6 13 30V16.2z" fill="#E0A14A"/>
                <circle cx="32" cy="26.5" r="5.5" fill="#101218"/>
                <path d="M29.8 30h4.4v13.5a2.2 2.2 0 0 1-4.4 0z" fill="#101218"/>
                <path d="M33.6 37.5h7a1.8 1.8 0 0 1 0 3.6h-7z" fill="#101218"/>
              </svg>
            </div>
            <div>
              <strong>PRIVGATE</strong>
              <span>Privilege elevation</span>
            </div>
          </div>
          <button className="ghost icon-btn" onClick={() => setRail(true)} type="button" aria-controls="console-rail" aria-expanded={!railHidden}>
            Hide
          </button>
        </div>
        <nav aria-label="Console">
          {groups.map((group) => (
            <div key={group.label ?? "anchor"} className={"nav-group" + (group.bottom ? " nav-group-bottom" : "")}>
              {group.label ? <div className="nav-section-label">{group.label}</div> : null}
              {group.bottom && updateBadge ? (
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
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  title={item.label}
                  className={"nav-link" + (activeHref === item.href ? " active" : "")}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                  {typeof item.count === "number" ? <span className="nav-count">{item.count}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <button className="ghost signout-btn" onClick={logout} type="button">
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
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              <IconSvg>{THEME_ICON[theme]}</IconSvg>
            </button>
          </div>
        </header>
        <div className="main">{children}</div>
      </div>
    </div>
    </SessionContext.Provider>
  );
}
