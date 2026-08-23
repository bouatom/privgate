import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const MAX_LINES = 400;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("module size", () => {
  it(`keeps src/lib TypeScript modules at or under ${MAX_LINES} lines`, () => {
    const lib = path.join(ROOT, "lib");
    const oversized = walk(lib)
      .map((file) => ({
        file: path.relative(ROOT, file),
        lines: readFileSync(file, "utf8").split("\n").length,
      }))
      .filter((row) => row.lines > MAX_LINES);
    expect(oversized).toEqual([]);
  });
});
