import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type UacPrompt = {
  id: string;
  userId: string;
  deviceId: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments: string;
  firstAt: string;
  lastAt: string;
  count: number;
  lastOutcome: string;
};

export type UacPromptRow = UacPrompt & { userName: string; hostname: string };

function fromRow(row: Record<string, unknown>): UacPrompt {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    filePath: String(row.file_path),
    fileHash: String(row.file_hash),
    publisher: String(row.publisher),
    arguments: String(row.arguments ?? ""),
    firstAt: String(row.first_at),
    lastAt: String(row.last_at),
    count: Number(row.count) || 1,
    lastOutcome: String(row.last_outcome),
  };
}

export function listUacPrompts(db: DatabaseSync): UacPromptRow[] {
  const rows = db
    .prepare(
      `SELECT p.*, u.display_name AS user_name, d.hostname
       FROM uac_prompts p
       JOIN users u ON u.id = p.user_id
       JOIN devices d ON d.id = p.device_id
       ORDER BY p.last_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    ...fromRow(row),
    userName: String(row.user_name),
    hostname: String(row.hostname),
  }));
}

export function listUacPromptsForDevice(db: DatabaseSync, deviceId: string): UacPromptRow[] {
  const rows = db
    .prepare(
      `SELECT p.*, u.display_name AS user_name, d.hostname
       FROM uac_prompts p
       JOIN users u ON u.id = p.user_id
       JOIN devices d ON d.id = p.device_id
       WHERE p.device_id = ?
       ORDER BY p.last_at DESC`,
    )
    .all(deviceId) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...fromRow(row),
    userName: String(row.user_name),
    hostname: String(row.hostname),
  }));
}

/** Same open prompt (retries while last_outcome is still prompted) must not inflate Times. */
function shouldCountAppearance(existing: Record<string, unknown>): boolean {
  if (String(existing.last_outcome) !== "prompted") return true;
  const last = Date.parse(String(existing.last_at));
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= 120_000;
}

/**
 * One row per (device, user, program). `seen` counts a new stock-UAC
 * appearance; `closed` updates the classifier verdict without double-counting
 * when the prompt was already recorded as it appeared.
 */
export function upsertUacPrompt(
  db: DatabaseSync,
  input: {
    userId: string;
    deviceId: string;
    filePath: string;
    fileHash?: string;
    publisher?: string;
    arguments?: string;
    lastOutcome: string;
    phase: "seen" | "closed";
  },
): UacPrompt & { created: boolean } {
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT * FROM uac_prompts WHERE device_id = ? AND user_id = ? AND file_path = ?`,
    )
    .get(input.deviceId, input.userId, input.filePath) as Record<string, unknown> | undefined;
  if (!existing) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO uac_prompts (
         id, user_id, device_id, file_path, file_hash, publisher, arguments,
         first_at, last_at, count, last_outcome
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.userId,
      input.deviceId,
      input.filePath,
      input.fileHash ?? "",
      input.publisher ?? "",
      input.arguments ?? "",
      now,
      now,
      input.lastOutcome,
    );
    return {
      ...fromRow(db.prepare("SELECT * FROM uac_prompts WHERE id = ?").get(id) as Record<string, unknown>),
      created: true,
    };
  }
  const hash = (input.fileHash && input.fileHash.length > 0 ? input.fileHash : String(existing.file_hash)) || "";
  const publisher =
    (input.publisher && input.publisher.trim() ? input.publisher : String(existing.publisher)) || "";
  const args =
    input.arguments && input.arguments.length > 0 ? input.arguments : String(existing.arguments ?? "");
  const count =
    input.phase === "seen" && shouldCountAppearance(existing)
      ? Number(existing.count) + 1
      : Number(existing.count) || 1;
  db.prepare(
    `UPDATE uac_prompts
     SET file_hash = ?, publisher = ?, arguments = ?, last_at = ?, count = ?, last_outcome = ?
     WHERE id = ?`,
  ).run(hash, publisher, args, now, count, input.lastOutcome, String(existing.id));
  return {
    ...fromRow(db.prepare("SELECT * FROM uac_prompts WHERE id = ?").get(String(existing.id)) as Record<string, unknown>),
    created: false,
  };
}
