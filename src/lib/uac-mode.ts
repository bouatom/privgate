/** Environment-wide stock-UAC follow-up: collect silently or offer a PrivGate request. */
export type UacMode = "prompt" | "collect";

export function parseUacMode(raw: unknown): UacMode {
  return String(raw || "").trim().toLowerCase() === "collect" ? "collect" : "prompt";
}
