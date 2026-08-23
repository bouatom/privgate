import { describe, expect, it } from "vitest";
import { getUserByUpn, resetDbForTests, upsertUsers } from "./index";

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
