import type { DatabaseSync } from "node:sqlite";
import type { Policy, PolicyEffect } from "../policy";

export function listPolicies(db: DatabaseSync): Policy[] {
  const rows = db.prepare("SELECT * FROM policies ORDER BY name").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    effect: String(row.effect) as PolicyEffect,
    fileHash: String(row.file_hash),
    publisher: String(row.publisher),
    fileName: String(row.file_name) || undefined,
    argumentPattern: String(row.argument_pattern) || undefined,
    bindType: String(row.bind_type) as Policy["bindType"],
    bindId: String(row.bind_id) || undefined,
    childProcesses: (String(row.child_processes) as "deny" | "allow") || "deny",
    highRiskException: Number(row.high_risk_exception) === 1,
  }));
}

export function insertPolicy(db: DatabaseSync, policy: Policy) {
  db.prepare(
    `INSERT INTO policies (id, name, effect, file_hash, publisher, file_name, argument_pattern, bind_type, bind_id, child_processes, high_risk_exception, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    policy.id,
    policy.name,
    policy.effect,
    policy.fileHash.toLowerCase(),
    policy.publisher,
    policy.fileName ?? "",
    policy.argumentPattern ?? "",
    policy.bindType,
    policy.bindId ?? "",
    policy.childProcesses,
    policy.highRiskException ? 1 : 0,
    new Date().toISOString(),
  );
}

export function deletePolicy(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM policies WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function updatePolicy(db: DatabaseSync, id: string, policy: Policy): boolean {
  const result = db
    .prepare(
      `UPDATE policies SET name = ?, effect = ?, file_hash = ?, publisher = ?, file_name = ?, argument_pattern = ?, bind_type = ?, bind_id = ?, child_processes = ?, high_risk_exception = ? WHERE id = ?`,
    )
    .run(
      policy.name,
      policy.effect,
      policy.fileHash.toLowerCase(),
      policy.publisher,
      policy.fileName ?? "",
      policy.argumentPattern ?? "",
      policy.bindType,
      policy.bindId ?? "",
      policy.childProcesses,
      policy.highRiskException ? 1 : 0,
      id,
    );
  return Number(result.changes) > 0;
}
