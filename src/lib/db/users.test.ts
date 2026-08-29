import { describe, expect, it } from "vitest";
import { getUserByUpn, resetDbForTests, upsertUsers } from "./index";
import { createJit } from "./jit";

describe("upsertUsers", () => {
  it("keeps an on-prem SID when a later Entra sync omits it", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [
      {
        displayName: "Ada",
        userPrincipalName: "ada@contoso.test",
        adSid: "S-1-5-21-1-2-3-1101",
      },
    ]);
    upsertUsers(db, [
      {
        displayName: "Ada Admin",
        userPrincipalName: "ada@contoso.test",
        entraOid: "entra-oid-ada",
        adSid: "",
      },
    ]);
    const user = getUserByUpn(db, "ada@contoso.test");
    expect(user?.displayName).toBe("Ada Admin");
    expect(user?.adSid).toBe("S-1-5-21-1-2-3-1101");
    expect(user?.entraOid).toBe("entra-oid-ada");
  });

  it("keeps an Entra object id when a later AD sync omits it", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [
      {
        displayName: "Ada",
        userPrincipalName: "ada@contoso.test",
        entraOid: "entra-oid-ada",
      },
    ]);
    upsertUsers(db, [
      {
        displayName: "Ada Admin",
        userPrincipalName: "ada@contoso.test",
        adSid: "S-1-5-21-1-2-3-1101",
        entraOid: "",
      },
    ]);
    const user = getUserByUpn(db, "ada@contoso.test");
    expect(user?.adSid).toBe("S-1-5-21-1-2-3-1101");
    expect(user?.entraOid).toBe("entra-oid-ada");
  });
});

describe("disable-user removal regressions", () => {
  it("no capability path can set disabled via upsertUsers", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [{ displayName: "Riley", userPrincipalName: "riley@contoso.test" }]);
    const user = getUserByUpn(db, "riley@contoso.test")!;
    expect(user.disabled).toBe(0);
  });

  it("a leftover jit_eligible=0 row is still JIT-grantable", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [{ displayName: "Riley", userPrincipalName: "riley@contoso.test" }]);
    const user = getUserByUpn(db, "riley@contoso.test")!;
    db.prepare("UPDATE users SET jit_eligible = 0 WHERE id = ?").run(user.id);

    const grant = createJit(db, {
      userId: user.id,
      deviceId: "dev-lab-01",
      durationMinutes: 15,
      reason: "eligibility flag is gone",
    });
    expect("error" in grant).toBe(false);
  });

  it("a directory user with Approver/PolicyAdmin role strings is still JIT-grantable", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [
      {
        displayName: "Ada",
        userPrincipalName: "ada@contoso.test",
        roles: ["Approver", "PolicyAdmin"],
      },
    ]);
    const user = getUserByUpn(db, "ada@contoso.test")!;
    const grant = createJit(db, {
      userId: user.id,
      deviceId: "dev-lab-01",
      durationMinutes: 15,
      reason: "synced users are all grantable",
    });
    expect("error" in grant).toBe(false);
  });

  it("a legacy-disabled directory account is still JIT-grantable (disable no longer gates)", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [{ displayName: "Riley", userPrincipalName: "riley@contoso.test" }]);
    const user = getUserByUpn(db, "riley@contoso.test")!;
    db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(user.id);

    const grant = createJit(db, {
      userId: user.id,
      deviceId: "dev-lab-01",
      durationMinutes: 15,
      reason: "disable flag is out of scope",
    });
    expect("error" in grant).toBe(false);
  });
});
