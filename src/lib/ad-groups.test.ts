import { afterEach, describe, expect, it } from "vitest";
import {
  activeJit,
  createJit,
  groupIdsForUser,
  listGroups,
  replaceGroups,
  resetDbForTests,
} from "./db";
import { AD_GROUP_FILTER, adUserDnIndex, applyAdDirectorySync, groupsFromLdapEntries } from "./ad-groups";
import { sidFromBinary } from "./ad-sid";
import { evaluateElevation } from "./policy";

const BASE_DN = "DC=contoso,DC=test";

const sidStr = (buf: Buffer) => sidFromBinary(buf);

function sidBuf(...subauthorities: number[]): Buffer {
  const buf = Buffer.alloc(8 + subauthorities.length * 4);
  buf[0] = 1;
  buf[1] = subauthorities.length;
  buf.writeUIntBE(5, 2, 6); // 48-bit identifier authority
  subauthorities.forEach((sub, i) => buf.writeUInt32LE(sub, 8 + i * 4));
  return buf;
}

function userEntry(dn: string, sam: string, sid?: Buffer) {
  return { dn, sAMAccountName: sam, displayName: sam, ...(sid ? { objectSid: sid } : {}) };
}

function groupEntry(dn: string, name: string, sid: Buffer | undefined, member: unknown) {
  return { dn, cn: name, member, ...(sid ? { objectSid: sid } : {}) };
}

function seedDb() {
  const db = resetDbForTests(":memory:", { seedDemo: false });
  db.prepare(
    `INSERT INTO devices (id, hostname, join_type, secret_enc, enrolled_at) VALUES ('dev-1', 'LAB-W11-01', 'hybrid', 'test-enc', ?)`,
  ).run(new Date().toISOString());
  return db;
}

afterEach(() => {
  resetDbForTests(":memory:", { seedDemo: false });
});

describe("AD security-group sync", () => {
  it("targets security-enabled groups only via the LDAP filter bit", () => {
    expect(AD_GROUP_FILTER).toContain("objectClass=group");
    expect(AD_GROUP_FILTER).toContain("1.2.840.113556.1.4.803:=2147483648");
  });

  it("builds a DN→UPN index that skips MSOL_ service accounts", () => {
    const entries = [
      userEntry("CN=Dana,OU=Users,DC=contoso,DC=test", "dana", sidBuf(100, 1)),
      userEntry("CN=MSOL_ad8c1f0,CN=Managed Service Accounts,DC=contoso,DC=test", "MSOL_ad8c1f0"),
    ];
    const index = adUserDnIndex(entries, BASE_DN);
    expect(index.get("cn=dana,ou=users,dc=contoso,dc=test")).toBe("dana@contoso.test");
    expect(index.size).toBe(1);
  });

  it("maps group entries to plans keyed by SID; unresolvable members and non-group entries drop out", () => {
    const danaDn = "CN=Dana,OU=Users,DC=contoso,DC=test";
    const leeDn = "CN=Lee,OU=Users,DC=contoso,DC=test";
    const usersByDn = new Map([
      [danaDn.toLowerCase(), "dana@contoso.test"],
      [leeDn.toLowerCase(), "lee@contoso.test"],
    ]);
    const gsid = sidBuf(21, 1000, 2000, 3000, 501);
    const plans = groupsFromLdapEntries(
      [
        groupEntry("CN=Helpdesk,OU=Groups,DC=contoso,DC=test", "Helpdesk", gsid, [
          danaDn,
          leeDn,
          "CN=Gone,OU=Users,DC=contoso,DC=test",
        ]),
        // No cn/dn → not a usable group object (guards fake/partial payloads).
        { objectSid: sidBuf(21, 9), member: [] },
      ],
      usersByDn,
    );
    expect(plans).toEqual([
      {
        id: sidStr(gsid),
        name: "Helpdesk",
        objectId: sidStr(gsid),
        dn: "CN=Helpdesk,OU=Groups,DC=contoso,DC=test",
        memberUpns: ["dana@contoso.test", "lee@contoso.test"],
      },
    ]);
  });

  it("persists synced groups scoped to source 'ad' with dn, SID id, and MSOL_ noise excluded", () => {
    const db = seedDb();
    const gsid = sidBuf(21, 1000, 2000, 3000, 501);
    const result = applyAdDirectorySync(
      db,
      [userEntry("CN=Dana,OU=Users,DC=contoso,DC=test", "dana", sidBuf(21, 1000, 2000, 3000, 1101))],
      [
        groupEntry("CN=Helpdesk,OU=Groups,DC=contoso,DC=test", "Helpdesk", gsid, [
          "CN=Dana,OU=Users,DC=contoso,DC=test",
          "CN=MSOL_ad8c1f0,CN=Managed Service Accounts,DC=contoso,DC=test",
        ]),
        // No SID → DN becomes the stable id; zero resolved members is fine.
        groupEntry("CN=All Staff,OU=Groups,DC=contoso,DC=test", "All Staff", undefined, []),
      ],
      BASE_DN,
    );
    expect(result).toEqual({ users: 1, groups: 2 });
    const helpdesk = listGroups(db).find((g) => g.name === "Helpdesk")!;
    expect(helpdesk).toMatchObject({
      directorySource: "ad",
      objectId: sidStr(gsid),
      dn: "CN=Helpdesk,OU=Groups,DC=contoso,DC=test",
    });
    // MSOL_ sync/service account never leaks into membership counts.
    expect(helpdesk.memberCount).toBe(1);
  });

  it("feeds JIT grants and group-bound policy scope end-to-end via groupIdsForUser", () => {
    const db = seedDb();
    const gsid = sidBuf(21, 1000, 2000, 3000, 501);
    const usid = sidBuf(21, 1000, 2000, 3000, 1101);
    applyAdDirectorySync(
      db,
      [userEntry("CN=Dana,OU=Users,DC=contoso,DC=test", "dana", usid)],
      [
        groupEntry("CN=HELPDESK,OU=Groups,DC=contoso,DC=test", "Helpdesk", gsid, [
          "cn=dana,ou=users,dc=contoso,dc=test",
          "cn=msol_ad8c1f0,cn=managed service accounts,dc=contoso,dc=test",
        ]),
      ],
      BASE_DN,
    );
    const dana = db.prepare("SELECT * FROM users WHERE upn = 'dana@contoso.test'").get() as {
      id: string;
      ad_sid: string;
    };
    const groupIds = groupIdsForUser(db, dana.id);
    expect(groupIds).toEqual([sidStr(gsid)]);

    // Group-scoped JIT grant covers the synced member per existing snapshot semantics.
    const grant = createJit(db, {
      groupId: sidStr(gsid),
      deviceId: "dev-1",
      durationMinutes: 30,
      reason: "patch window",
    });
    if ("error" in grant) throw new Error(grant.error);
    expect(activeJit(db, dana.id, "dev-1")?.id).toBe(grant.id);

    // Policy bindType 'group' matches through the same membership seam as evaluate.ts.
    const hash = "a".repeat(64);
    const decision = evaluateElevation(
      { userId: dana.id, userSid: sidStr(usid), groupIds, deviceId: "dev-1" },
      { filePath: "C:\\Windows\\System32\\notepad.exe", fileHash: hash, publisher: "CN=Microsoft Windows" },
      [
        {
          id: "pol-helpdesk",
          name: "Helpdesk notepad",
          effect: "allow",
          fileHash: hash,
          publisher: "CN=Microsoft Windows",
          bindType: "group",
          bindId: sidStr(gsid),
          childProcesses: "deny",
          highRiskException: false,
        },
      ],
      false,
    );
    expect(decision.decision).toBe("allow");
  });

  it("keeps entra-sourced groups intact when AD replaces source 'ad' (and vice versa)", () => {
    const db = seedDb();
    replaceGroups(
      db,
      [{ id: "g-entra", name: "Finance", objectId: "obj-1", memberUserIds: [], dn: "" }],
      "entra",
    );
    applyAdDirectorySync(
      db,
      [],
      [groupEntry("CN=Helpdesk,OU=Groups,DC=contoso,DC=test", "Helpdesk", sidBuf(21, 7), [])],
      BASE_DN,
    );
    expect(listGroups(db).map((g) => `${g.directorySource}:${g.name}`).sort()).toEqual([
      "ad:Helpdesk",
      "entra:Finance",
    ]);

    // An Entra resync must not wipe the AD rows either.
    replaceGroups(db, [{ id: "g-entra", name: "Finance", objectId: "obj-1", memberUserIds: [] }]);
    expect(listGroups(db).map((g) => g.directorySource).sort()).toEqual(["ad", "entra"]);
  });

  it("tolerates stub sessions that answer every search with user-shaped entries", () => {
    const plans = groupsFromLdapEntries(
      [{ dn: "", displayName: "Ada Admin", userPrincipalName: "ada@contoso.test" }],
      new Map(),
    );
    expect(plans).toEqual([]);
  });
});
