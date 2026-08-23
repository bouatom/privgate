import { describe, expect, it } from "vitest";
import { getUserByUpn, listUsers, resetDbForTests } from "./index";
import { portalNeedsSetup } from "../portal";
import { isWizardCompleted } from "../setup-state";
import { purgeDemoFixtures, seedDemo } from "./seed";

describe("demo fixtures", () => {
  it("does not insert Ada or Riley when opening a new database", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    expect(listUsers(db)).toEqual([]);
    expect(getUserByUpn(db, "ada@contoso.test")).toBeUndefined();
    expect(getUserByUpn(db, "riley@contoso.test")).toBeUndefined();
    expect(portalNeedsSetup(db)).toBe(true);
    expect(isWizardCompleted(db)).toBe(false);
  });

  it("refuses to load demo data outside tests", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    expect(() =>
      seedDemo(db, { NODE_ENV: "production", VITEST: "", PRIVGATE_ALLOW_FIXTURES: "0" }),
    ).toThrow(/production/);
  });

  it("strips leftover Ada and Riley identities from a production database", () => {
    const db = resetDbForTests(":memory:");
    expect(getUserByUpn(db, "ada@contoso.test")?.displayName).toBe("Ada Admin");
    expect(getUserByUpn(db, "riley@contoso.test")?.displayName).toBe("Riley Regular");
    purgeDemoFixtures(db, { PRIVGATE_ALLOW_FIXTURES: "0" });
    expect(getUserByUpn(db, "ada@contoso.test")).toBeUndefined();
    expect(getUserByUpn(db, "riley@contoso.test")).toBeUndefined();
    expect(listUsers(db)).toEqual([]);
  });
});
