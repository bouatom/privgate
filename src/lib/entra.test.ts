import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  DELEGATED,
  GRAPH_APP_ID,
  authorizeUrl,
  daemonApplicationBody,
  pkcePair,
  publicDirectoryStatus,
  setupApplicationBody,
  entraJwksUrl,
  entraIdTokenVerifyOptions,
} from "./entra";
import { resetDbForTests, replaceGroups, groupIdsForUser, listGroups } from "./db";
import { setupRedirectUris } from "./origin";

describe("entra setup payloads", () => {
  it("requests Graph app roles for daemon sync and delegated write for setup", () => {
    const daemon = daemonApplicationBody(["http://localhost:3000/api/setup/entra/callback"]);
    const setup = setupApplicationBody(["http://localhost:3000/api/setup/entra/callback"]);
    const daemonRoles = daemon.requiredResourceAccess[0]?.resourceAccess.map((r) => r.id);
    const setupScopes = setup.requiredResourceAccess[0]?.resourceAccess.map((r) => r.id);
    expect(daemon.requiredResourceAccess[0]?.resourceAppId).toBe(GRAPH_APP_ID);
    expect(daemonRoles).toEqual(expect.arrayContaining([APP_ROLES.userReadAll, APP_ROLES.groupReadAll, APP_ROLES.directoryReadAll]));
    expect(daemon.requiredResourceAccess[0]?.resourceAccess.every((r) => r.type === "Role")).toBe(true);
    expect(setupScopes).toEqual(
      expect.arrayContaining([DELEGATED.applicationReadWriteAll, DELEGATED.appRoleAssignmentReadWriteAll]),
    );
    expect(setup.isFallbackPublicClient).toBe(true);
  });

  it("builds a PKCE authorize URL", () => {
    const { challenge } = pkcePair();
    const url = authorizeUrl({
      tenant: "organizations",
      clientId: "11111111-1111-1111-1111-111111111111",
      redirectUri: "http://localhost:3000/api/setup/entra/callback",
      state: "abc",
      challenge,
    });
    expect(url).toContain("login.microsoftonline.com/organizations");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("Application.ReadWrite.All");
  });

  it("reports disconnected directory by default", () => {
    const db = resetDbForTests(":memory:");
    expect(publicDirectoryStatus(db)).toEqual({ connected: false });
  });

  it("keeps localhost callback URIs when origin is another host", () => {
    const uris = setupRedirectUris("https://privgate.contoso.test");
    expect(uris).toContain("https://privgate.contoso.test/api/setup/entra/callback");
    expect(uris).toContain("http://localhost:3000/api/auth/entra/callback");
  });
});

describe("directory groups", () => {
  it("replaces group membership used for policy binds", () => {
    const db = resetDbForTests(":memory:");
    replaceGroups(db, [
      { id: "g1", name: "Finance", objectId: "g1", memberUserIds: ["user-admin"] },
    ]);
    expect(listGroups(db)[0]?.name).toBe("Finance");
    expect(groupIdsForUser(db, "user-admin")).toEqual(["g1"]);
    // Entra replacement is source-scoped: the seeded 'seed' fixture group
    // survives (AD groups must too), while entra rows are fully replaced.
    expect(groupIdsForUser(db, "user-staff")).toEqual(["g-helpdesk"]);
    expect(listGroups(db).filter((g) => g.directorySource === "entra")).toHaveLength(1);
  });
});

describe("entra id_token verification options", () => {
  it("pins issuer for a directory tenant and skips it for organizations", () => {
    const tenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(entraJwksUrl(tenant)).toContain(tenant);
    expect(entraIdTokenVerifyOptions(tenant, "client")).toEqual({
      audience: "client",
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    });
    expect(entraIdTokenVerifyOptions("organizations", "client")).toEqual({ audience: "client" });
  });
});
