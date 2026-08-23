import { afterEach, describe, expect, it } from "vitest";
import { ldapUrl, setOpenLdapForTests, syncAdUsers, testAdBind } from "./ad-ldap";
import { sidFromBinary } from "./ad-sid";
import { getUserByUpn, resetDbForTests, saveAdSettings, upsertUsers } from "./db";

afterEach(() => {
  setOpenLdapForTests();
});

describe("ldapUrl", () => {
  it("builds ldap and ldaps URLs and rejects path characters", () => {
    expect(ldapUrl("dc01.contoso.test", 636, true)).toBe("ldaps://dc01.contoso.test:636");
    expect(ldapUrl("dc01.contoso.test", 389, false)).toBe("ldap://dc01.contoso.test:389");
    expect(() => ldapUrl("dc01.contoso.test/cn=evil", 636, true)).toThrow(/Invalid/);
  });
});

describe("AD LDAP bind and sync", () => {
  it("refuses to bind without a saved host and password", async () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    await expect(testAdBind(db)).rejects.toThrow(/host/i);
    saveAdSettings(db, { host: "dc01.contoso.test", bindDn: "CN=PrivGate,DC=contoso,DC=test" });
    await expect(testAdBind(db)).rejects.toThrow(/password/i);
  });

  it("imports AD users without clearing an existing Entra object id", async () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    upsertUsers(db, [
      {
        displayName: "Ada",
        userPrincipalName: "ada@contoso.test",
        entraOid: "entra-oid-ada",
      },
    ]);
    saveAdSettings(db, {
      host: "dc01.contoso.test",
      bindDn: "CN=PrivGate,DC=contoso,DC=test",
      baseDn: "DC=contoso,DC=test",
      password: "bind-secret",
    });
    const sid = Buffer.from([
      1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 232, 3, 0, 0, 208, 7, 0, 0, 184, 11, 0, 0, 244, 1, 0, 0,
    ]);
    setOpenLdapForTests(async () => ({
      bind: async () => undefined,
      search: async () => ({
        searchEntries: [
          {
            displayName: "Ada Admin",
            userPrincipalName: "ada@contoso.test",
            objectSid: sid,
          },
        ],
      }),
      unbind: async () => undefined,
    }));
    const result = await syncAdUsers(db);
    expect(result.users).toBe(1);
    const user = getUserByUpn(db, "ada@contoso.test");
    expect(user?.adSid).toBe(sidFromBinary(sid));
    expect(user?.entraOid).toBe("entra-oid-ada");
    expect(user?.displayName).toBe("Ada Admin");
  });
});
