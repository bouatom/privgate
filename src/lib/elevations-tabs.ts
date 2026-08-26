import { hasAnyPermission, type PermissionId } from "@/lib/permissions";

export type ElevationTab = "requests" | "jit";

/** Which permissions let an actor see each Elevations tab. */
const TAB_ACCESS: Record<ElevationTab, PermissionId[]> = {
  requests: ["requests.view"],
  jit: ["jit.view", "jit.grant"],
};

export function canSeeElevationTab(granted: readonly string[] | undefined, tab: ElevationTab): boolean {
  return hasAnyPermission(granted, [...TAB_ACCESS[tab]]);
}

export function canUseElevations(granted: readonly string[] | undefined): boolean {
  return canSeeElevationTab(granted, "requests") || canSeeElevationTab(granted, "jit");
}

/**
 * Default tab: Requests when allowed, otherwise JIT. Callers render <Forbidden />
 * when this lands on a tab the actor cannot see (neither permission at all).
 */
export function defaultElevationTab(granted: readonly string[] | undefined): ElevationTab {
  return canSeeElevationTab(granted, "requests") ? "requests" : "jit";
}

/**
 * Resolve the active tab from a raw searchParam. Unknown or disallowed values
 * fall back to the permission-aware default, so URLs stay shareable and a
 * JIT-only actor never gets the Requests panel via ?tab=requests.
 */
export function resolveElevationTab(
  raw: string | string[] | undefined,
  granted: readonly string[] | undefined,
): ElevationTab {
  if ((raw === "requests" || raw === "jit") && canSeeElevationTab(granted, raw)) return raw;
  return defaultElevationTab(granted);
}

export const ELEVATIONS_TABS: Array<{ id: ElevationTab; label: string }> = [
  { id: "requests", label: "Requests" },
  { id: "jit", label: "JIT access" },
];

/** Tabs the given actor may see, in display order. */
export function visibleElevationTabs(granted: readonly string[] | undefined) {
  return ELEVATIONS_TABS.filter((tab) => canSeeElevationTab(granted, tab.id));
}

export function elevationTabHref(tab: ElevationTab): string {
  return tab === "jit" ? "/elevations?tab=jit" : "/elevations";
}
