import { describe, expect, it } from "vitest";
import { IDENTITY_MODE_COPY, identityMode } from "./identity-mode";

describe("identityMode", () => {
  it("treats AD and Entra as independent sources", () => {
    expect(identityMode({ entraConnected: false, adConfigured: false })).toBe("none");
    expect(identityMode({ entraConnected: false, adConfigured: true })).toBe("ad");
    expect(identityMode({ entraConnected: true, adConfigured: false })).toBe("entra");
    expect(identityMode({ entraConnected: true, adConfigured: true })).toBe("hybrid");
  });

  it("describes each topology without coupling the two products", () => {
    expect(IDENTITY_MODE_COPY.ad.body).toMatch(/Entra ID is optional/i);
    expect(IDENTITY_MODE_COPY.entra.body).toMatch(/Active Directory is optional/i);
    expect(IDENTITY_MODE_COPY.hybrid.body).toMatch(/independently/i);
    expect(IDENTITY_MODE_COPY.none.body).not.toMatch(/hybrid identity only/i);
  });
});
