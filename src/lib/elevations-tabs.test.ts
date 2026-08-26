import { describe, expect, it } from "vitest";
import {
  canSeeElevationTab,
  canUseElevations,
  defaultElevationTab,
  elevationTabHref,
  resolveElevationTab,
  visibleElevationTabs,
} from "./elevations-tabs";

const FULL = ["requests.view", "requests.approve", "jit.view", "jit.grant"];

describe("resolveElevationTab", () => {
  it("defaults to requests for actors holding requests.view", () => {
    expect(defaultElevationTab(FULL)).toBe("requests");
    expect(defaultElevationTab(["requests.view"])).toBe("requests");
    expect(resolveElevationTab(undefined, FULL)).toBe("requests");
  });

  it("defaults to jit when the actor lacks requests.view but holds jit access", () => {
    expect(defaultElevationTab(["jit.view"])).toBe("jit");
    expect(defaultElevationTab(["jit.grant"])).toBe("jit");
    expect(resolveElevationTab(undefined, ["jit.view", "jit.revoke"])).toBe("jit");
  });

  it("honours an explicit ?tab value the actor may see", () => {
    expect(resolveElevationTab("jit", FULL)).toBe("jit");
    expect(resolveElevationTab("requests", FULL)).toBe("requests");
  });

  it("falls back to the default for unknown, array-valued, or disallowed tab params", () => {
    expect(resolveElevationTab("bogus", FULL)).toBe("requests");
    expect(resolveElevationTab(["jit"], FULL)).toBe("requests");
    // JIT-only actor asking for ?tab=requests must not get the Requests panel.
    expect(resolveElevationTab("requests", ["jit.view"])).toBe("jit");
    // Requests-only actor asking for ?tab=jit stays on Requests.
    expect(resolveElevationTab("jit", ["requests.view"])).toBe("requests");
  });

  it("treats missing permissions like today's pages: nothing resolves visibly", () => {
    // Falls through to the jit slot; the page renders <Forbidden /> because
    // canUseElevations() is false, matching /requests' gate today.
    expect(resolveElevationTab(undefined, [])).toBe("jit");
    expect(canUseElevations([])).toBe(false);
    expect(canUseElevations(undefined)).toBe(false);
    expect(visibleElevationTabs([])).toEqual([]);
  });

  it("gates each tab by its own permission set and orders tabs for display", () => {
    expect(canSeeElevationTab(["requests.view"], "requests")).toBe(true);
    expect(canSeeElevationTab(["requests.view"], "jit")).toBe(false);
    expect(canSeeElevationTab(["jit.grant"], "jit")).toBe(true);
    expect(visibleElevationTabs(["jit.view"]).map((t) => t.id)).toEqual(["jit"]);
    expect(visibleElevationTabs(FULL).map((t) => t.id)).toEqual(["requests", "jit"]);
  });

  it("maps tabs to shareable URLs", () => {
    expect(elevationTabHref("requests")).toBe("/elevations");
    expect(elevationTabHref("jit")).toBe("/elevations?tab=jit");
  });
});
