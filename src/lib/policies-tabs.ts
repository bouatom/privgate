export type PolicyTab = "rules" | "elevation";

export const POLICIES_TABS: Array<{ id: PolicyTab; label: string }> = [
  { id: "rules", label: "Always-allow" },
  { id: "elevation", label: "Elevation mode" },
];

export function resolvePolicyTab(raw: string | string[] | undefined): PolicyTab {
  return raw === "elevation" ? "elevation" : "rules";
}

export function policyTabHref(tab: PolicyTab): string {
  return tab === "elevation" ? "/allowlists?tab=elevation" : "/allowlists";
}
