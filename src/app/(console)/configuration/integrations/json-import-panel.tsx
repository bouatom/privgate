"use client";

import type { FormEvent } from "react";

export function JsonImportPanel({
  importJson,
  setImportJson,
  onImport,
}: {
  importJson: string;
  setImportJson: (value: string) => void;
  onImport: (e: FormEvent) => void;
}) {
  return (
    <form className="panel stack" style={{ padding: 18 }} onSubmit={onImport}>
      <strong>Manual JSON import</strong>
      <p className="lede" style={{ fontSize: 12 }}>
        Optional third source. Not a fallback for Entra or AD — use it when you are not syncing from
        either directory, or to add a few accounts by hand.
      </p>
      <textarea rows={6} value={importJson} onChange={(e) => setImportJson(e.target.value)} />
      <button className="primary" type="submit">
        Upsert users
      </button>
    </form>
  );
}
