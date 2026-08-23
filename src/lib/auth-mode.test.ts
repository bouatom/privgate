import { describe, expect, it } from "vitest";
import { entraSsoAvailable, localLoginOffered } from "./auth-mode";

describe("entraSsoAvailable", () => {
  it("is false until tenant and client id exist", () => {
    expect(entraSsoAvailable(undefined, {})).toBe(false);
    expect(entraSsoAvailable({ tenantId: "t", setupClientId: "" }, {})).toBe(false);
    expect(entraSsoAvailable({ tenantId: "", setupClientId: "c" }, {})).toBe(false);
  });

  it("is true from directory settings or env", () => {
    expect(entraSsoAvailable({ tenantId: "t", setupClientId: "c" }, {})).toBe(true);
    expect(
      entraSsoAvailable(undefined, { AZURE_AD_TENANT_ID: "t", AZURE_AD_CLIENT_ID: "c" }),
    ).toBe(true);
  });
});

describe("localLoginOffered", () => {
  it("stays on when AUTH_MODE is local", () => {
    expect(localLoginOffered(false, { AUTH_MODE: "local" })).toBe(true);
    expect(localLoginOffered(true, { AUTH_MODE: "local" })).toBe(true);
  });

  it("hides the password form only when Entra SSO is actually available", () => {
    expect(localLoginOffered(true, { AUTH_MODE: "entra" })).toBe(false);
    expect(localLoginOffered(false, { AUTH_MODE: "entra" })).toBe(true);
  });
});
