import { describe, expect, it } from "vitest";
import { displayPath, formatDetails, formatWhenShort } from "./format";

describe("display helpers", () => {
  it("collapses doubled Windows path slashes", () => {
    expect(displayPath("C:\\\\Program Files\\\\Vendor\\\\Update.exe")).toBe("C:\\Program Files\\Vendor\\Update.exe");
  });

  it("summarizes audit details without raw JSON braces when values are strings", () => {
    expect(formatDetails({ file: "Update.exe", host: "LAB-W11-01" })).toBe("file: Update.exe · host: LAB-W11-01");
  });

  it("describes recent times in short form", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(formatWhenShort(twoMinAgo)).toBe("2 min ago");
  });
});
