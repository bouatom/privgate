import type { DatabaseSync } from "node:sqlite";
import { parseUacMode, type UacMode } from "../uac-mode";

export type ElevationSettings = { uacMode: UacMode };

export function getElevationSettings(db: DatabaseSync): ElevationSettings {
  const row = db.prepare("SELECT uac_mode FROM elevation_settings WHERE id = 'default'").get() as
    | { uac_mode?: string }
    | undefined;
  return { uacMode: parseUacMode(row?.uac_mode) };
}

export function saveElevationSettings(db: DatabaseSync, uacMode: UacMode): ElevationSettings {
  const mode = parseUacMode(uacMode);
  db.prepare(
    `INSERT INTO elevation_settings (id, uac_mode) VALUES ('default', ?)
     ON CONFLICT(id) DO UPDATE SET uac_mode = excluded.uac_mode`,
  ).run(mode);
  return { uacMode: mode };
}
