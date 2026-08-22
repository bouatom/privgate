"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type RequestRow = {
  id: string;
  status: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments: string;
  userName: string;
  hostname: string;
  requestedAt: string;
  riskLevel: string;
  riskReasons: string;
};

function reasonsOf(row: RequestRow): string[] {
  try {
    const parsed = JSON.parse(row.riskReasons || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function RequestsClient({ rows }: { rows: RequestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function act(id: string, action: "approve" | "deny", row: RequestRow) {
    if (action === "approve" && (row.riskLevel === "high" || row.riskLevel === "critical")) {
      const why = reasonsOf(row)[0] || "This process looks suspicious.";
      if (!confirm(`${row.riskLevel.toUpperCase()} risk: ${why}\n\nApprove elevation anyway?`)) return;
    }
    setBusy(id);
    await fetch(`/api/requests/${id}/${action}`, { method: "POST" });
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const hot = rows.filter((r) => r.status === "pending" && (r.riskLevel === "high" || r.riskLevel === "critical")).length;

  return (
    <>
      <div className="top">
        <div>
          <h1>Elevation requests</h1>
          <p className="lede">
            Standard users asked to run something that is not on the always-allow list. Risk is scored from the
            binary, path, publisher, and arguments — not the filename alone.
          </p>
        </div>
      </div>
      <div className="grid cards" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="k">Pending</div>
          <div className="v">{pending}</div>
        </div>
        <div className="card">
          <div className="k">High / critical</div>
          <div className="v">{hot}</div>
        </div>
        <div className="card">
          <div className="k">Rule</div>
          <div className="v" style={{ fontSize: 16, marginTop: 12 }}>Hash + publisher, never filename alone</div>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Risk</th>
              <th>User / host</th>
              <th>Program</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><span className={`pill ${row.status}`}>{row.status}</span></td>
                <td>
                  <span className={`pill risk-${row.riskLevel || "medium"}`}>{row.riskLevel || "medium"}</span>
                  <ul className="risk-reasons">
                    {reasonsOf(row).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </td>
                <td>
                  {row.userName}
                  <div className="mono">{row.hostname}</div>
                </td>
                <td>
                  <div>{row.filePath}</div>
                  <div className="mono">{row.publisher}</div>
                  <div className="mono">{row.fileHash.slice(0, 16)}…</div>
                  {row.arguments ? <div className="mono">{row.arguments}</div> : null}
                </td>
                <td>
                  {row.status === "pending" ? (
                    <div className="row-actions">
                      <button className="primary" disabled={busy === row.id} onClick={() => act(row.id, "approve", row)}>
                        Approve
                      </button>
                      <button className="danger" disabled={busy === row.id} onClick={() => act(row.id, "deny", row)}>
                        Deny
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
