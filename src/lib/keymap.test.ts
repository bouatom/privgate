import { describe, expect, it } from "vitest";
import { isEditableTarget, queueKeyAction } from "./keymap";

function key(key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) {
  return { key, ...mods };
}

describe("queueKeyAction", () => {
  it("maps j/J to next and k/K to prev", () => {
    expect(queueKeyAction(key("j"))).toBe("next");
    expect(queueKeyAction(key("J"))).toBe("next");
    expect(queueKeyAction(key("k"))).toBe("prev");
    expect(queueKeyAction(key("K"))).toBe("prev");
  });

  it("maps a/A to approve and d/D to deny", () => {
    expect(queueKeyAction(key("a"))).toBe("approve");
    expect(queueKeyAction(key("A"))).toBe("approve");
    expect(queueKeyAction(key("d"))).toBe("deny");
    expect(queueKeyAction(key("D"))).toBe("deny");
  });

  it("ignores keys when any modifier is held", () => {
    expect(queueKeyAction(key("j", { ctrlKey: true }))).toBeNull();
    expect(queueKeyAction(key("k", { metaKey: true }))).toBeNull();
    expect(queueKeyAction(key("a", { altKey: true }))).toBeNull();
    expect(queueKeyAction(key("d", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("returns null for unmapped keys", () => {
    expect(queueKeyAction(key("Enter"))).toBeNull();
    expect(queueKeyAction(key("x"))).toBeNull();
    expect(queueKeyAction(key(""))).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("treats form fields as editable", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("treats contenteditable elements as editable", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("allows non-editable targets and nullish values", () => {
    expect(isEditableTarget({ tagName: "TR" })).toBe(false);
    expect(isEditableTarget({ tagName: "BODY", isContentEditable: false })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget("not an element")).toBe(false);
    expect(isEditableTarget({})).toBe(false);
  });
});
