/** Admin-facing labels for stock-UAC classifier verdicts. */
export function uacOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "prompted":
      return "Prompted";
    case "escaped":
      return "Dismissed";
    case "timeout":
      return "Timed out";
    case "unknown":
      return "Closed";
    case "approved-self":
      return "Approved (user)";
    case "approved-other":
      return "Approved (other)";
    case "canceled":
      return "Canceled";
    default:
      return outcome || "Closed";
  }
}

export function uacOutcomePill(outcome: string): string {
  if (outcome === "approved-self" || outcome === "approved-other") return "approved";
  if (outcome === "prompted") return "pending";
  return "denied";
}
