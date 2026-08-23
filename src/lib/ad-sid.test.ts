import { describe, expect, it } from "vitest";
import { dnsDomainFromBaseDn, sidFromBinary, usersFromLdapEntries } from "./ad-sid";

describe("sidFromBinary", () => {
  it("decodes a typical domain SID plus RID", () => {
    // S-1-5-21-1000-2000-3000-500
    const buf = Buffer.from([
      1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 232, 3, 0, 0, 208, 7, 0, 0, 184, 11, 0, 0, 244, 1, 0, 0,
    ]);
    expect(sidFromBinary(buf)).toBe("S-1-5-21-1000-2000-3000-500");
  });

  it("ignores a textual SID left in the attribute", () => {
    expect(sidFromBinary("S-1-5-21-1-2-3-4")).toBe("");
  });
});

describe("dnsDomainFromBaseDn", () => {
  it("joins DC components", () => {
    expect(dnsDomainFromBaseDn("OU=Users,DC=contoso,DC=test")).toBe("contoso.test");
  });
});

describe("usersFromLdapEntries", () => {
  it("prefers UPN and keeps objectSid", () => {
    const sid = Buffer.from([
      1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 232, 3, 0, 0, 208, 7, 0, 0, 184, 11, 0, 0, 244, 1, 0, 0,
    ]);
    const users = usersFromLdapEntries(
      [
        {
          displayName: "Ada Admin",
          userPrincipalName: "ada@contoso.test",
          sAMAccountName: "ada",
          objectSid: sid,
        },
      ],
      "DC=contoso,DC=test",
    );
    expect(users).toEqual([
      {
        displayName: "Ada Admin",
        userPrincipalName: "ada@contoso.test",
        adSid: "S-1-5-21-1000-2000-3000-500",
      },
    ]);
  });

  it("synthesizes a UPN from sAMAccountName when Graph-style UPN is missing", () => {
    const users = usersFromLdapEntries(
      [{ sAMAccountName: "riley", cn: "Riley Regular" }],
      "DC=contoso,DC=test",
    );
    expect(users[0]).toMatchObject({
      displayName: "Riley Regular",
      userPrincipalName: "riley@contoso.test",
      adSid: "",
    });
  });
});
