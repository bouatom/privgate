import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resetDbForTests, decideRequest, listPolicies, getUserByUpn, createJit, revokeJit, getRequest, insertPolicy } from "./db";
import { evaluateForDevice, ticketKeyForDevice } from "./evaluate";
import { verifyTicket } from "./signing";

const staffSid = "S-1-5-21-1000-1000-1000-1101";

afterEach(() => {
  resetDbForTests(":memory:");
});

describe("evaluate + approval + JIT", () => {
  it("allowlists the seeded Widget MSI and refuses PowerShell", () => {
    const db = resetDbForTests(":memory:");
    const widget = listPolicies(db)[0];
    const allow = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\install\\\\WidgetSetup.msi",
      fileHash: widget.fileHash,
      publisher: widget.publisher,
    });
    expect(allow.decision).toBe("allow");
    expect(allow.ticket).toBeTruthy();
    const ticket = verifyTicket(allow.ticket!, ticketKeyForDevice("dev-lab-01"));
    expect(ticket.child).toBe("deny");

    const deny = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe",
      fileHash: createHash("sha256").update("ps").digest("hex"),
      publisher: "CN=Microsoft Windows",
    });
    expect(deny.decision).toBe("deny");
    expect(deny.riskLevel).toBe("critical");
    expect(deny.requestId).toBeTruthy();
    expect(getRequest(db, deny.requestId!)?.status).toBe("denied");
  });

  it("creates a pending request then issues a one-shot ticket on approve", () => {
    const db = resetDbForTests(":memory:");
    const pending = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Tools\\\\Rare.exe",
      fileHash: createHash("sha256").update("rare").digest("hex"),
      publisher: "CN=Rare",
    });
    expect(pending.decision).toBe("pending");
    expect(pending.requestId).toBeTruthy();
    expect(pending.riskLevel).toBe("low");
    const decided = decideRequest(db, pending.requestId!, "approved", "ada@contoso.test");
    expect(decided?.status).toBe("approved");
  });

  it("grants and revokes a JIT window", () => {
    const db = resetDbForTests(":memory:");
    const staff = getUserByUpn(db, "riley@contoso.test")!;
    const grant = createJit(db, {
      userId: staff.id,
      deviceId: "dev-lab-01",
      durationMinutes: 15,
      reason: "install vendor printer",
    });
    expect("id" in grant).toBe(true);
    if (!("id" in grant)) throw new Error("expected grant");
    const during = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Windows\\\\System32\\\\cmd.exe",
      fileHash: "00",
      publisher: "CN=Microsoft Windows",
    });
    expect(during.decision).toBe("allow");
    revokeJit(db, grant.id, "ada@contoso.test");
    const after = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Windows\\\\System32\\\\cmd.exe",
      fileHash: "00",
      publisher: "CN=Microsoft Windows",
    });
    expect(after.decision).toBe("deny");
  });

  it("stores high risk on unsigned user-writable pending requests", () => {
    const db = resetDbForTests(":memory:");
    const pending = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Users\\\\riley\\\\Downloads\\\\payload.exe",
      fileHash: createHash("sha256").update("payload").digest("hex"),
      publisher: "dry-run",
    });
    expect(pending.decision).toBe("pending");
    expect(pending.riskLevel).toBe("high");
    const stored = getRequest(db, pending.requestId!);
    expect(stored?.riskLevel).toBe("high");
    expect(stored?.riskReasons).toMatch(/publisher|user-writable|unsigned/i);
  });

  it("allowlists only members of a bound group", () => {
    const db = resetDbForTests(":memory:");
    insertPolicy(db, {
      id: "pol-helpdesk-only",
      name: "Helpdesk notepad",
      effect: "allow",
      fileHash: createHash("sha256").update("notepad-helpdesk").digest("hex"),
      publisher: "CN=Microsoft Windows",
      fileName: "notepad.exe",
      bindType: "group",
      bindId: "g-helpdesk",
      childProcesses: "deny",
      highRiskException: false,
    });
    const hash = createHash("sha256").update("notepad-helpdesk").digest("hex");
    const staff = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Windows\\\\System32\\\\notepad.exe",
      fileHash: hash,
      publisher: "CN=Microsoft Windows",
    });
    expect(staff.decision).toBe("allow");

    const admin = evaluateForDevice(db, "dev-lab-01", {
      userSid: "S-1-5-21-1000-1000-1000-500",
      filePath: "C:\\\\Windows\\\\System32\\\\notepad.exe",
      fileHash: hash,
      publisher: "CN=Microsoft Windows",
    });
    expect(admin.decision).toBe("pending");
  });
});
