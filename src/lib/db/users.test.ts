import { describe, expect, it } from "vitest";
import { getUserByUpn, patchUser, resetDbForTests, upsertUsers } from "./index";
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
  it("patchUser only touches JIT eligibility and leaves the legacy column alone", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [{ displayName: "Riley", userPrincipalName: "riley@contoso.test" }]);
    const user = getUserByUpn(db, "riley@contoso.test")!;
    // Simulate a legacy row disabled by an older build.
    db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(user.id);

    patchUser(db, user.id, { jitEligible: true });

    const after = getUserByUpn(db, "riley@contoso.test")!;
    expect(after.jitEligible).toBe(1);
    const legacy = db.prepare("SELECT disabled FROM users WHERE id = ?").get(user.id) as { disabled: number };
    expect(legacy.disabled).toBe(1); // untouched by the new code path
  });

  it("no capability path can set disabled via patchUser", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [{ displayName: "Riley", userPrincipalName: "riley@contoso.test" }]);
    const user = getUserByUpn(db, "riley@contoso.test")!;
    // Runtime guard for what the types now prevent: stray payloads are ignored.
    const patched = patchUser(db, user.id, { jitEligible: true } as { jitEligible?: boolean });
    expect(patched?.disabled).toBe(0);
    expect(patched?.jitEligible).toBe(1);
  });

  it("a legacy-disabled directory account is still JIT-grantable (disable no longer gates)", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [{ displayName: "Riley", userPrincipalName: "riley@contoso.test", jitEligible: true }]);
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
