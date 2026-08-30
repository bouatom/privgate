import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { policyTabHref, resolvePolicyTab, POLICIES_TABS } from "./policies-tabs";

describe("policies tabs", () => {
  it("defaults to always-allow rules and honours ?tab=elevation", () => {
    expect(resolvePolicyTab(undefined)).toBe("rules");
    expect(resolvePolicyTab("rules")).toBe("rules");
    expect(resolvePolicyTab("elevation")).toBe("elevation");
    expect(resolvePolicyTab(["elevation"])).toBe("rules");
    expect(policyTabHref("rules")).toBe("/allowlists");
    expect(policyTabHref("elevation")).toBe("/allowlists?tab=elevation");
    expect(POLICIES_TABS.map((t) => t.id)).toEqual(["rules", "elevation"]);
  });

  it("lives under Policies, not Settings", () => {
    const config = readFileSync(join(__dirname, "permissions.ts"), "utf8");
    expect(config).not.toContain("/configuration/elevation");
    expect(readFileSync(join(__dirname, "../app/(console)/nav-model.ts"), "utf8")).toContain(
      'href: "/allowlists"',
    );
    expect(
      readFileSync(join(__dirname, "../app/(console)/configuration/elevation/page.tsx"), "utf8"),
    ).toContain("/allowlists?tab=elevation");
  });
});
