import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { assertPassword } from "./passwords";
import { countPortalUsers, createPortalUser } from "./portal";

export type BootstrapPayload = {
  email?: string;
  password?: string;
  displayName?: string;
};

export function dataDir(env: Record<string, string | undefined> = process.env): string {
  if (env.PRIVGATE_DATA_DIR) return env.PRIVGATE_DATA_DIR;
  const db = env.PRIVGATE_DB || "";
  if (db && db !== ":memory:") return path.dirname(db);
  if (process.platform === "win32") {
    return path.join(env.ProgramData || "C:\\ProgramData", "PrivGate");
  }
  if (process.platform === "darwin") return "/Library/Application Support/PrivGate";
  return "/var/lib/privgate";
}

export function bootstrapPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(dataDir(env), "bootstrap.json");
}

export function consumeBootstrap(db: DatabaseSync, env: Record<string, string | undefined> = process.env): void {
  const file = bootstrapPath(env);
  if (!fs.existsSync(file)) return;
  let payload: BootstrapPayload = {};
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8")) as BootstrapPayload;
  } catch {
    console.error("PrivGate: bootstrap.json is not valid JSON; leaving it in place");
    return;
  }
  if (countPortalUsers(db) > 0) {
    fs.unlinkSync(file);
    return;
  }
  const email = (payload.email || "").trim();
  const password = payload.password || "";
  const displayName = (payload.displayName || "").trim() || email.split("@")[0] || "Administrator";
  const problem = assertPassword(password);
  if (!email.includes("@") || problem) {
    console.error("PrivGate: bootstrap.json is missing a valid email or password; leaving it in place");
    return;
  }
  const created = createPortalUser(db, {
    displayName,
    email,
    kind: "local",
    password,
    roleIds: ["role-master-admin"],
  });
  if ("error" in created) {
    console.error(`PrivGate: bootstrap failed: ${created.error}`);
    return;
  }
  fs.unlinkSync(file);
  console.log(`PrivGate: created initial Master Admin ${created.email}`);
}
