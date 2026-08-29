/**
 * Client-safe constants that can be imported in "use client" components.
 * These values mirror the server-side validation in passwords.ts.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Client-side password validation (mirrors server-side assertPassword).
 * Returns undefined if valid, error string if invalid.
 */
export function assertClientPassword(plain: string | undefined): string | undefined {
  const value = (plain || "").trim();
  if (!value) return "password required";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
}