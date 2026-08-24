import { describe, expect, it } from "vitest";
import {
  argumentPatternError,
  argumentPatternFromDraft,
  describeVerdict,
  effectError,
  emptyRuleDraft,
  previewRuleAgainstRequests,
  ruleDraftToPolicyBody,
  type PreviewableRequest,
  type RuleDraft,
} from "./policy-draft-preview";

const HASH = "aa".repeat(32);

function request(overrides: Partial<PreviewableRequest> = {}): PreviewableRequest {
  return {
    id: "req-1",
    userId: "user-1",
    deviceId: "dev-1",
    filePath: "C:\\Tools\\WidgetSetup.msi",
    fileHash: HASH,
    publisher: "CN=Contoso Code Signing",
    arguments: '"C:\\Tools\\setup.msi" /qn',
    requestedAt: new Date().toISOString(),
    userName: "A. Admin",
    hostname: "LAB-W11-01",
    ...overrides,
  };
}

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return { ...emptyRuleDraft(), fileHash: HASH, publisher: "cn=contoso code signing", ...overrides };
}

describe("argumentPatternFromDraft", () => {
  it("returns no pattern for blank text so any arguments match", () => {
    expect(argumentPatternFromDraft("", "literal")).toBe("");
    expect(argumentPatternFromDraft("   ", "regex")).toBe("");
  });

  it("escapes literal text and anchors the whole argument string", () => {
    const pattern = argumentPatternFromDraft('"C:\\Tools\\setup.msi" /qn', "literal");
    expect(pattern).toBe('^"C:\\\\Tools\\\\setup\\.msi" /qn$');
    // Wildcards typed by hand must stay literal, not silently widen the rule.
    expect(new RegExp(pattern).test("anything.msi")).toBe(false);
    expect(new RegExp(pattern).test('"C:\\Tools\\setup.msi" /qn')).toBe(true);
  });

  it("passes advanced regex through trimmed", () => {
    expect(argumentPatternFromDraft("  /qn$  ", "regex")).toBe("/qn$");
  });
});

describe("draft validation helpers", () => {
  it("accepts compiling regexes and rejects broken ones", () => {
    expect(argumentPatternError(undefined)).toBeNull();
    expect(argumentPatternError("/qn$")).toBeNull();
    expect(argumentPatternError("(")).toMatch(/not a valid regular expression/i);
  });

  it("accepts only known effects", () => {
    expect(effectError(undefined)).toBeNull();
    expect(effectError("deny")).toBeNull();
    expect(effectError("require_approval")).toBeNull();
    expect(effectError("block")).toMatch(/unknown effect/i);
  });
});

describe("ruleDraftToPolicyBody", () => {
  it("trims inputs and drops empty optional fields", () => {
    const body = ruleDraftToPolicyBody(draft({ name: " Widget ", fileName: "  ", argumentsText: "" }));
    expect(body.name).toBe("Widget");
    expect(body.fileName).toBeUndefined();
    expect(body.argumentPattern).toBeUndefined();
    expect(body.childProcesses).toBe("deny");
    expect(body.highRiskException).toBe(false);
  });

  it("clears bindId when the rule is not group-bound", () => {
    expect(ruleDraftToPolicyBody(draft({ bindType: "all", bindId: "leftover" })).bindId).toBe("");
    expect(ruleDraftToPolicyBody(draft({ bindType: "group", bindId: "g1" })).bindId).toBe("g1");
  });

  it("keeps the chosen effect instead of hardcoding allow", () => {
    expect(ruleDraftToPolicyBody(draft({ effect: "require_approval" })).effect).toBe("require_approval");
  });
});

describe("previewRuleAgainstRequests", () => {
  it("matches identical requests case-insensitively regardless of draft effect", () => {
    for (const effect of ["allow", "deny", "require_approval"] as const) {
      const [verdict] = previewRuleAgainstRequests(ruleDraftToPolicyBody(draft({ effect })), [request()]);
      expect(verdict.matches).toBe(true);
      expect(verdict.missed).toBe("");
    }
  });

  it("reports which criterion failed, in engine order", () => {
    const body = ruleDraftToPolicyBody(
      draft({ fileName: "WidgetSetup.msi", argumentsText: '"C:\\Tools\\setup.msi" /qn' }),
    );
    const [hashMiss, publisherMiss, nameMiss, argsMiss] = previewRuleAgainstRequests(body, [
      request({ fileHash: "bb".repeat(32) }),
      request({ publisher: "CN=Other" }),
      request({ filePath: "C:\\Elsewhere\\Other.msi" }),
      request({ arguments: "/quiet" }),
    ]);
    expect(hashMiss.missed).toBe("hash differs");
    expect(publisherMiss.missed).toBe("publisher differs");
    expect(nameMiss.missed).toBe("file name differs");
    expect(argsMiss.missed).toBe("arguments do not match");
  });

  it("treats a wildcard publisher as the literal string it is", () => {
    const body = ruleDraftToPolicyBody(draft({ publisher: "CN=Contoso*" }));
    const [verdict] = previewRuleAgainstRequests(body, [request()]);
    expect(verdict.matches).toBe(false);
    expect(verdict.missed).toBe("publisher differs");
  });

  it("ignores arguments when the draft has none", () => {
    const body = ruleDraftToPolicyBody(draft({ argumentsText: "" }));
    const [verdict] = previewRuleAgainstRequests(body, [request({ arguments: "" })]);
    expect(verdict.matches).toBe(true);
  });

  it("resolves device binds per recorded PC", () => {
    const body = { ...ruleDraftToPolicyBody(draft()), bindType: "device" as const, bindId: "dev-1" };
    const [same, other] = previewRuleAgainstRequests(body, [request(), request({ deviceId: "dev-2" })]);
    expect(same.matches).toBe(true);
    expect(other.matches).toBe(false);
    expect(other.missed).toBe("bound to a different PC");
  });

  it("resolves group binds through the directory membership map", () => {
    const body = { ...ruleDraftToPolicyBody(draft()), bindType: "group" as const, bindId: "g1" };
    const groupsByUser = { "user-1": ["g1"], "user-2": [] };
    const [member, outsider, unknownUser] = previewRuleAgainstRequests(
      body,
      [request(), request({ userId: "user-2" }), request({ userId: "user-3" })],
      groupsByUser,
    );
    expect(member.matches).toBe(true);
    expect(outsider.matches).toBe(false);
    expect(outsider.missed).toBe("user is not in the bound group");
    expect(unknownUser.matches).toBe(false);
  });
});

describe("describeVerdict", () => {
  it("labels the action each effect would take on a matching request", () => {
    const requests = [request()];
    for (const effect of ["allow", "deny", "require_approval"] as const) {
      const body = ruleDraftToPolicyBody(draft({ effect }));
      const [verdict] = previewRuleAgainstRequests(body, requests);
      const described = describeVerdict(body, verdict);
      expect(described.kind).toBe(effect);
      if (effect === "allow") expect(described.label).toMatch(/elevate silently/i);
      if (effect === "deny") expect(described.label).toMatch(/denied/i);
      if (effect === "require_approval") expect(described.label).toMatch(/approval/i);
    }
  });

  it("warns that hard-banned binaries are blocked before rules apply", () => {
    const body = ruleDraftToPolicyBody(draft());
    const shells = previewRuleAgainstRequests(body, [
      request({ filePath: "C:\\Windows\\System32\\cmd.exe", fileHash: HASH }),
    ]);
    const described = describeVerdict(body, shells[0]);
    expect(shells[0].matches).toBe(true);
    expect(described.kind).toBe("hard-banned");
    expect(described.label).toMatch(/hard-banned/i);
  });

  it("summarizes misses with the failing criterion", () => {
    const body = ruleDraftToPolicyBody(draft());
    const [verdict] = previewRuleAgainstRequests(body, [request({ publisher: "CN=Other" })]);
    const described = describeVerdict(body, verdict);
    expect(described.kind).toBe("miss");
    expect(described.label).toContain("publisher differs");
  });
});
