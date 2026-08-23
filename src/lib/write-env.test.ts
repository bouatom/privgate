import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const writeEnvPath = path.resolve(__dirname, "../../packaging/write-env.cjs");
const { applyInstallerConfig, parseEnvFile } = require(writeEnvPath) as {
  applyInstallerConfig: (dir: string, opts?: Record<string, unknown>) => string;
  parseEnvFile: (text: string) => Record<string, string>;
};

const dirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "privgate-env-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readEnv(dir: string) {
  return parseEnvFile(readFileSync(path.join(dir, "console.env"), "utf8"));
}

describe("applyInstallerConfig", () => {
  it("creates secrets on first write and leaves them alone on a no-op upgrade", () => {
    const dir = tempDir();
    applyInstallerConfig(dir, { bind: "10.0.0.5", webPort: "8443", agentPort: "8444" });
    const first = readEnv(dir);
    expect(first.PRIVGATE_BIND).toBe("10.0.0.5");
    expect(first.PRIVGATE_WEB_PORT).toBe("8443");
    expect(first.SESSION_SECRET).toBeTruthy();

    applyInstallerConfig(dir, {});
    const second = readEnv(dir);
    expect(second.SESSION_SECRET).toBe(first.SESSION_SECRET);
    expect(second.TICKET_SIGNING_KEY).toBe(first.TICKET_SIGNING_KEY);
    expect(second.DEVICE_SECRET_KEY).toBe(first.DEVICE_SECRET_KEY);
    expect(second.PRIVGATE_BIND).toBe("10.0.0.5");
    expect(second.PRIVGATE_WEB_PORT).toBe("8443");
    expect(second.PRIVGATE_AGENT_PORT).toBe("8444");
  });

  it("still applies an explicit first-install listen change", () => {
    const dir = tempDir();
    applyInstallerConfig(dir, { bind: "0.0.0.0", webPort: "3000", agentPort: "3001" });
    applyInstallerConfig(dir, { bind: "127.0.0.1", webPort: "8080", agentPort: "8081" });
    const env = readEnv(dir);
    expect(env.PRIVGATE_BIND).toBe("127.0.0.1");
    expect(env.PRIVGATE_WEB_PORT).toBe("8080");
    expect(env.PRIVGATE_AGENT_PORT).toBe("8081");
  });
});

describe("write-env --preserve", () => {
  it("does not overwrite listen settings or secrets when --preserve is set", () => {
    const dir = tempDir();
    applyInstallerConfig(dir, { bind: "10.1.2.3", webPort: "4000", agentPort: "4001" });
    const first = readEnv(dir);

    const result = spawnSync(
      process.execPath,
      [writeEnvPath, "--dir", dir, "--preserve", "--bind", "0.0.0.0", "--web-port", "1", "--agent-port", "2"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);

    const second = readEnv(dir);
    expect(second.PRIVGATE_BIND).toBe("10.1.2.3");
    expect(second.PRIVGATE_WEB_PORT).toBe("4000");
    expect(second.PRIVGATE_AGENT_PORT).toBe("4001");
    expect(second.SESSION_SECRET).toBe(first.SESSION_SECRET);
  });

  it("does not apply default ports when the CLI omits listen flags", () => {
    const dir = tempDir();
    applyInstallerConfig(dir, { bind: "192.168.1.8", webPort: "9443", agentPort: "9444" });

    const result = spawnSync(process.execPath, [writeEnvPath, "--dir", dir], { encoding: "utf8" });
    expect(result.status).toBe(0);

    const env = readEnv(dir);
    expect(env.PRIVGATE_BIND).toBe("192.168.1.8");
    expect(env.PRIVGATE_WEB_PORT).toBe("9443");
    expect(env.PRIVGATE_AGENT_PORT).toBe("9444");
  });
});
