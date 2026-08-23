import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "../app");
const MODELS = path.resolve(__dirname, "models.ts");

const FORBIDDEN = [
  "@/lib/db",
  "@/lib/auth",
  "@/lib/portal",
  "@/lib/present",
  "@/lib/bootstrap",
  "@/lib/passwords",
  "@/lib/crypto-secret",
  "@/lib/evaluate",
  "@/lib/signing",
  "@/lib/device-auth",
  "@/lib/entra",
  "@/lib/listen",
  "@/lib/smtp",
  "@/lib/notify",
  "@/lib/zip",
  "@/lib/az-bootstrap",
  "@/lib/device-installer",
  "@/lib/client-package",
  "@/lib/client-binaries",
  "@/lib/deployment-script",
  "@/lib/client-msi",
  "@/lib/client-msi-slots",
  "@/lib/enrollment",
  "@/lib/metrics",
  "@/lib/http",
  "@/lib/setup-state",
  "@/lib/realtime/bus",
  "@/lib/realtime/notify",
  "@/lib/realtime/rpc",
  "@/lib/realtime/agent-hub",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function isClient(src: string): boolean {
  return /^\s*["']use client["']/.test(src);
}

describe("client / Node boundary", () => {
  it("keeps models.ts free of Node builtins so the browser bundler can load it", () => {
    const src = readFileSync(MODELS, "utf8");
    expect(src).not.toMatch(/from ["']node:/);
    expect(src).not.toMatch(/require\(["']node:/);
  });

  it("does not import Node-bound modules from Client Components", () => {
    const clients = walk(APP).filter((file) => isClient(readFileSync(file, "utf8")));
    expect(clients.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (const file of clients) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(path.resolve(__dirname, "../.."), file);
      for (const mod of FORBIDDEN) {
        if (src.includes(`from "${mod}"`) || src.includes(`from '${mod}'`)) {
          leaks.push(`${rel} imports ${mod}`);
        }
      }
      if (/from ["']node:/.test(src)) {
        leaks.push(`${rel} imports a node: module`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
