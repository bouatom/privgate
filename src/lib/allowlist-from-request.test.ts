import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowlistBlockedReason,
  allowlistDraftFromRequest,
  allowPolicyCoversRequest,
  argumentPatternFromArgs,
} from "./allowlist-from-request";
import { getRequest, insertPolicy, resetDbForTests } from "./db";
import { evaluateForDevice } from "./evaluate";

const staffSid = "S-1-5-21-1000-1000-1000-1101";

describe("allowlist from a blocked elevation", () => {
  it("refuses shells and missing hash or publisher", () => {
    expect(allowlistBlockedReason("C:\\\\Windows\\\\System32\\\\cmd.exe", "abc", "CN=Microsoft")).toMatch(
      /cannot be always-allow/i,
    );
    expect(allowlistBlockedReason("C:\\\\Tools\\\\Disk.exe", "", "CN=Contoso")).toMatch(/hash and publisher/i);
    expect(allowlistBlockedReason("(unidentified program)", "", "")).toMatch(/could not identify/i);
  });

  it("pins MMC snap-in arguments so Disk Management is not a blanket mmc.exe allow", () => {
    const args = '"C:\\\\Windows\\\\System32\\\\diskmgmt.msc"';
    const draft = allowlistDraftFromRequest(
      {
        filePath: "C:\\\\Windows\\\\System32\\\\mmc.exe",
        fileHash: "aa".repeat(32),
        publisher: "CN=Microsoft Windows",
        arguments: args,
        hostname: "LAB-W11-01",
        deviceId: "dev-lab-01",
      },
      "device",
    );
    expect(draft.bindType).toBe("device");
    expect(draft.bindId).toBe("dev-lab-01");
    expect(draft.fileName).toBe("mmc.exe");
    expect(draft.argumentPattern).toBe(argumentPatternFromArgs(args));
    expect(draft.name).toMatch(/mmc\.exe/i);
    expect(draft.name).toMatch(/diskmgmt/i);
  });

  it("turns a recorded elevation into an always-allow that then succeeds", () => {
    const db = resetDbForTests(":memory:");
    const fileHash = createHash("sha256").update("diskmgmt-mmc").digest("hex");
    const publisher = "CN=Microsoft Windows";
    const args = '"C:\\\\Windows\\\\System32\\\\diskmgmt.msc"';
    const pending = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: "C:\\\\Windows\\\\System32\\\\mmc.exe",
      fileHash,
      publisher,
      arguments: args,
    });
    expect(pending.decision).toBe("pending");
    const stored = getRequest(db, pending.requestId!);
    expect(stored?.fileHash).toBe(fileHash);
    expect(allowlistBlockedReason(stored!.filePath, stored!.fileHash, stored!.publisher)).toBeNull();

    const draft = allowlistDraftFromRequest(
      {
        filePath: stored!.filePath,
        fileHash: stored!.fileHash,
        publisher: stored!.publisher,
        arguments: stored!.arguments,
        hostname: "LAB-W11-01",
        deviceId: stored!.deviceId,
      },
      "device",
    );
    insertPolicy(db, { id: "pol-from-log", ...draft });
    expect(
      allowPolicyCoversRequest(
        { id: "pol-from-log", ...draft },
        {
          filePath: stored!.filePath,
          fileHash: stored!.fileHash,
          publisher: stored!.publisher,
          arguments: stored!.arguments,
          deviceId: stored!.deviceId,
        },
      ),
    ).toBe(true);

    const again = evaluateForDevice(db, "dev-lab-01", {
      userSid: staffSid,
      filePath: stored!.filePath,
      fileHash,
      publisher,
      arguments: args,
    });
    expect(again.decision).toBe("allow");
  });
});
