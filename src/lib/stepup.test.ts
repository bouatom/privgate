import { describe, expect, it } from "vitest";
import { checkStepUpPassword } from "./stepup";
import { hashPassword } from "./passwords";

const ACTING_HASH = hashPassword("Correct-Pass-123");

describe("checkStepUpPassword", () => {
  describe("non-password edits", () => {
    it("never require step-up (displayName/roleIds/disabled)", () => {
      expect(
        checkStepUpPassword({
          settingPassword: false,
          actingKind: "local",
          actingPasswordHash: ACTING_HASH,
          stepUpPassword: undefined,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("local acting admin", () => {
    it("rejects a password change without stepUpPassword (400)", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: "local",
          actingPasswordHash: ACTING_HASH,
          stepUpPassword: undefined,
        }),
      ).toEqual({ ok: false, error: "current password required", status: 400 });
    });

    it("rejects a password change with an empty stepUpPassword (400)", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: "local",
          actingPasswordHash: ACTING_HASH,
          stepUpPassword: "",
        }),
      ).toEqual({ ok: false, error: "current password required", status: 400 });
    });

    it("rejects a wrong stepUpPassword (401)", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: "local",
          actingPasswordHash: ACTING_HASH,
          stepUpPassword: "Wrong-Password-999",
        }),
      ).toEqual({ ok: false, error: "invalid current password", status: 401 });
    });

    it("allows with a correct stepUpPassword", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: "local",
          actingPasswordHash: ACTING_HASH,
          stepUpPassword: "Correct-Pass-123",
        }),
      ).toEqual({ ok: true });
    });

    it("allows when the local admin has no password hash (edge case)", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: "local",
          actingPasswordHash: "",
          stepUpPassword: undefined,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("SSO acting admin", () => {
    it("allows a password change without step-up", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: "sso",
          actingPasswordHash: ACTING_HASH,
          stepUpPassword: undefined,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("unknown/missing acting admin", () => {
    it("allows a password change without step-up (session not in portal DB)", () => {
      expect(
        checkStepUpPassword({
          settingPassword: true,
          actingKind: undefined,
          actingPasswordHash: "",
          stepUpPassword: undefined,
        }),
      ).toEqual({ ok: true });
    });
  });
});
