import "server-only";
import { verifyPassword } from "./passwords";

/**
 * A password change that should either not require step-up, or has already
 * passed it. `ok: true` means the change may proceed.
 */
export type StepUpDecision =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 401 };

export type StepUpInput = {
  /** Whether the request is actually setting/clearing a password. */
  settingPassword: boolean;
  /** The acting admin's portal-user kind, if they exist in the portal DB. */
  actingKind: "local" | "sso" | undefined;
  /** The acting admin's packed password hash ('' if none set). */
  actingPasswordHash: string;
  /** The raw stepUpPassword value from the request body (optional). */
  stepUpPassword: string | undefined;
};

/**
 * Decide whether re-authentication (step-up) is required to proceed with a
 * portal password change, and if so whether the supplied credential verifies.
 *
 * Security rationale: a Master Admin can currently reset ANY account's
 * password (including another Master Admin's) using only a session cookie,
 * with no re-confirmation. Requiring the acting admin to re-enter their own
 * current password turns a single stolen/left-open session into a much weaker
 * attack: the attacker would also need the admin's password, and a wrong guess
 * is rejected (401) without leaking whether the value was plausible.
 *
 * Rules:
 *  - Non-password edits (displayName/roleIds/disabled) never require step-up.
 *  - SSO (or unknown/missing) acting admins: their session is already backed by
 *    an external identity provider, so no local confirmation is possible or
 *    required.
 *  - Local acting admin WITH a password hash: a valid stepUpPassword is required
 *    (400 if absent, 401 if it does not verify).
 *  - Local acting admin WITHOUT a password hash: nothing to confirm against, so
 *    the change is allowed (edge case — they cannot step up, and there is no
 *    credential to verify).
 */
export function checkStepUpPassword(input: StepUpInput): StepUpDecision {
  if (!input.settingPassword) return { ok: true };
  if (input.actingKind !== "local") return { ok: true };
  if (!input.actingPasswordHash) return { ok: true };

  const provided = input.stepUpPassword ?? "";
  if (!provided) return { ok: false, error: "current password required", status: 400 };
  if (!verifyPassword(provided, input.actingPasswordHash)) {
    // 401 (not 400) so a wrong guess is indistinguishable from a rejected
    // credential — avoids leaking whether the hash was even known.
    return { ok: false, error: "invalid current password", status: 401 };
  }
  return { ok: true };
}
