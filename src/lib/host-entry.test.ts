import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PACKAGING = path.resolve(__dirname, "../../packaging");
const dirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "privgate-host-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stageHost() {
  const app = tempDir();
  for (const name of ["host.cjs", "write-env.cjs", "listen-config.cjs", "startup-validation.cjs"]) {
    copyFileSync(path.join(PACKAGING, name), path.join(app, name));
  }
  writeFileSync(path.join(app, "listen.cjs"), '"use strict";\nconsole.log("listen-stub-ok");\n');
  return app;
}

describe("packaged host.cjs", () => {
  it("does not require TypeScript from src/", () => {
    const source = readFileSync(path.join(PACKAGING, "host.cjs"), "utf8");
    expect(source).not.toMatch(/startup-validation\.ts/);
    expect(source).not.toMatch(/\.\.\/src\//);
    expect(source).toContain('require("./startup-validation.cjs")');
  });

  it("starts past secret validation in an installer-shaped directory", () => {
    const app = stageHost();
    const data = tempDir();
    const env: NodeJS.ProcessEnv = { ...process.env, PRIVGATE_DATA_DIR: data };
    delete env.SESSION_SECRET;
    delete env.TICKET_SIGNING_KEY;
    delete env.DEVICE_SECRET_KEY;

    const result = spawnSync(process.execPath, [path.join(app, "host.cjs")], {
      encoding: "utf8",
      env,
      cwd: app,
    });

    expect(result.stderr).not.toMatch(/Cannot find module|Unknown file extension/i);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("listen-stub-ok");
  });
});
