import type { DatabaseSync } from "node:sqlite";
import { encryptSecret } from "../crypto-secret";
import type { AdSettings } from "../models";
import { deviceSecretKey } from "../secrets";

export function getAdSettings(db: DatabaseSync): AdSettings {
  const row = db.prepare("SELECT * FROM ad_settings WHERE id = 'default'").get() as Record<string, unknown> | undefined;
  if (!row) {
    return {
      configured: false,
      host: "",
      port: 636,
      useTls: true,
      bindDn: "",
      passwordSet: false,
      baseDn: "",
      userFilter: "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
      lastTestedAt: null,
      lastError: "",
    };
  }
  return {
    configured: Boolean(row.host),
    host: String(row.host || ""),
    port: Number(row.port || 636),
    useTls: Number(row.use_tls) === 1,
    bindDn: String(row.bind_dn || ""),
    passwordSet: Boolean(row.password_enc),
    baseDn: String(row.base_dn || ""),
    userFilter: String(row.user_filter || ""),
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastError: String(row.last_error || ""),
  };
}

export function saveAdSettings(
  db: DatabaseSync,
  patch: Partial<AdSettings> & { password?: string; lastError?: string; lastTestedAt?: string | null },
  actor = "",
) {
  const current = getAdSettings(db);
  const next = { ...current, ...patch };
  const existing = db.prepare("SELECT password_enc FROM ad_settings WHERE id = 'default'").get() as
    | { password_enc?: string }
    | undefined;
  let passEnc = existing?.password_enc || "";
  if (patch.password) passEnc = encryptSecret(patch.password, deviceSecretKey());
  db.prepare(
    `INSERT INTO ad_settings (id, host, port, use_tls, bind_dn, password_enc, base_dn, user_filter, last_tested_at, last_error, updated_by)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       host = excluded.host,
       port = excluded.port,
       use_tls = excluded.use_tls,
       bind_dn = excluded.bind_dn,
       password_enc = excluded.password_enc,
       base_dn = excluded.base_dn,
       user_filter = excluded.user_filter,
       last_tested_at = excluded.last_tested_at,
       last_error = excluded.last_error,
       updated_by = excluded.updated_by`,
  ).run(
    next.host,
    next.port,
    next.useTls ? 1 : 0,
    next.bindDn,
    passEnc,
    next.baseDn,
    next.userFilter,
    patch.lastTestedAt === undefined ? current.lastTestedAt : patch.lastTestedAt,
    patch.lastError === undefined ? current.lastError : patch.lastError,
    actor || "",
  );
}
