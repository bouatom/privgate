import { describe, expect, it } from "vitest";
import { assertAllowPolicyInput, evaluateElevation, type Policy } from "./policy";

const subject = {
  userId: "u1",
  userSid: "S-1-5-21-1",
  groupIds: ["g-helpdesk"],
  deviceId: "d1",
};

const widget: Policy = {
  id: "p1",
  name: "widget",
  effect: "allow",
  fileHash: "abc",
  publisher: "CN=Contoso",
  fileName: "WidgetSetup.msi",
  bindType: "all",
  childProcesses: "deny",
  highRiskException: false,
};

describe("evaluateElevation", () => {
  it("allows only when hash and publisher match", () => {
    const ok = evaluateElevation(subject, {
      filePath: "C:\\\\tmp\\\\WidgetSetup.msi",
      fileHash: "abc",
      publisher: "CN=Contoso",
    }, [widget], false);
    expect(ok.decision).toBe("allow");

    const wrongHash = evaluateElevation(subject, {
      filePath: "C:\\\\tmp\\\\WidgetSetup.msi",
      fileHash: "fff",
      publisher: "CN=Contoso",
    }, [widget], false);
    expect(wrongHash.decision).toBe("pending");

    const nameOnly: Policy = { ...widget, fileHash: "nope" };
    const byName = evaluateElevation(subject, {
      filePath: "C:\\\\tmp\\\\WidgetSetup.msi",
      fileHash: "abc",
      publisher: "CN=Contoso",
    }, [nameOnly], false);
    expect(byName.decision).not.toBe("allow");
  });

  it("denies hard-banned shells even if a policy tries to allow them", () => {
    const shell: Policy = {
      ...widget,
      fileHash: "ps1",
      publisher: "CN=Microsoft Windows",
      fileName: "powershell.exe",
      effect: "allow",
    };
    const result = evaluateElevation(subject, {
      filePath: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe",
      fileHash: "ps1",
      publisher: "CN=Microsoft Windows",
    }, [shell], false);
    expect(result.decision).toBe("deny");
    if (result.decision === "deny") expect(result.reason).toMatch(/hard-banned/);
  });

  it("allows any binary during an active JIT window", () => {
    const result = evaluateElevation(subject, {
      filePath: "C:\\\\Windows\\\\System32\\\\cmd.exe",
      fileHash: "x",
      publisher: "CN=Microsoft Windows",
    }, [], true);
    expect(result.decision).toBe("allow");
    if (result.decision === "allow") expect(result.policyId).toBe("jit");
  });

  it("rejects always-allow input for hard-banned names", () => {
    expect(
      assertAllowPolicyInput({
        effect: "allow",
        fileHash: "aa",
        publisher: "CN=x",
        fileName: "cmd.exe",
      }),
    ).toMatch(/hard-banned/);
  });

  it("allowlists a group member and not anyone else", () => {
    const policy: Policy = { ...widget, bindType: "group", bindId: "g-helpdesk" };
    const member = evaluateElevation(
      subject,
      { filePath: "C:\\\\tmp\\\\WidgetSetup.msi", fileHash: "abc", publisher: "CN=Contoso" },
      [policy],
      false,
    );
    expect(member.decision).toBe("allow");
    const outsider = evaluateElevation(
      { ...subject, groupIds: ["g-other"] },
      { filePath: "C:\\\\tmp\\\\WidgetSetup.msi", fileHash: "abc", publisher: "CN=Contoso" },
      [policy],
      false,
    );
    expect(outsider.decision).toBe("pending");
  });
});
