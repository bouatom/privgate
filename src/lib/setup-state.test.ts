import { describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { completeWizard, isWizardCompleted, seedSetupState } from "./setup-state";
import { createPortalUser } from "./portal";

describe("setup wizard state", () => {
  it("starts incomplete on an empty console", () => {
    const db = resetDbForTests(":memory:");
    expect(isWizardCompleted(db)).toBe(false);
  });

  it("does not auto-complete the wizard when a leftover portal user exists", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    db.prepare("DELETE FROM setup_state").run();
    const created = createPortalUser(db, {
      displayName: "Ops",
      email: "ops@example.test",
      kind: "local",
      password: "TestPass-12",
      roleIds: ["role-master-admin"],
    });
    if ("error" in created) throw new Error(created.error);
    seedSetupState(db);
    expect(isWizardCompleted(db)).toBe(false);
  });

  it("completeWizard is idempotent", () => {
    const db = resetDbForTests(":memory:");
    completeWizard(db);
    completeWizard(db);
    expect(isWizardCompleted(db)).toBe(true);
  });
});
