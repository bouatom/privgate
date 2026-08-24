export type QueueKeyAction = "next" | "prev" | "approve" | "deny";

/** Minimal shape of a keyboard event, so callers can pass DOM or React synthetic events. */
export type KeymapEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when keyboard shortcuts must be ignored because focus sits in a
 * form field or contenteditable region.
 */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (EDITABLE_TAGS.has(tag)) return true;
  return el.isContentEditable === true;
}

/**
 * Map an unmodified letter key to a queue action.
 * j/J -> next row, k/K -> prev row, a/A -> approve, d/D -> deny.
 * Returns null when any modifier is held or the key is unmapped.
 */
export function queueKeyAction(event: KeymapEvent): QueueKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case "j":
    case "J":
      return "next";
    case "k":
    case "K":
      return "prev";
    case "a":
    case "A":
      return "approve";
    case "d":
    case "D":
      return "deny";
    default:
      return null;
  }
}
