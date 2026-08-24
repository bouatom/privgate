"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { displayPath, formatWhenShort } from "@/lib/format";
import type { Policy } from "@/lib/policy";
import { isEditableTarget, queueKeyAction } from "@/lib/keymap";
import { AllowlistFromRequestButton } from "../allowlist-from-request-button";

export type RequestRow = {
  id: string;
  status: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments: string;
  userName: string;
  hostname: string;
  deviceId: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
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

export function RequestsClient({
  rows,
  canApprove,
  canDeny,
  canManageAllowlists,
  policies,
}: {
  rows: RequestRow[];
  canApprove: boolean;
  canDeny: boolean;
  canManageAllowlists: boolean;
  policies: Policy[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"pending" | "blocked" | "all">("pending");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  async function act(id: string, action: "approve" | "deny", row: RequestRow) {
    if (action === "approve" && (row.riskLevel === "high" || row.riskLevel === "critical")) {
      const why = reasonsOf(row)[0] || "This process looks suspicious.";
      if (!confirm(`${row.riskLevel.toUpperCase()} risk: ${why}\n\nApprove elevation anyway?`)) return;
    }
    setBusy(id);
    setError("");
    const res = await fetch(`/api/requests/${id}/${action}`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        res.status === 409
          ? "Another admin already decided this request."
          : body.error || `Could not ${action} this request.`,
      );
      setBusy(null);
      return;
    }
    startTransition(() => router.refresh());
    setBusy(null);
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const hot = rows.filter((r) => r.status === "pending" && (r.riskLevel === "high" || r.riskLevel === "critical")).length;
  const shown =
    filter === "pending"
      ? rows.filter((r) => r.status === "pending")
      : filter === "blocked"
        ? rows.filter((r) => r.status === "pending" || r.status === "denied" || r.status === "canceled")
        : rows;

  // Focused row: sticky while visible, otherwise defaults to the first pending row (or first row).
  const fallbackId = shown.find((r) => r.status === "pending")?.id ?? shown[0]?.id ?? null;
  const focusedRowId = focusedId && shown.some((r) => r.id === focusedId) ? focusedId : fallbackId;
  const focusedIndex = Math.max(0, shown.findIndex((r) => r.id === focusedRowId));

  function moveFocus(delta: number) {
    if (!shown.length) return;
    const next = shown[Math.min(shown.length - 1, Math.max(0, focusedIndex + delta))];
    if (!next) return;
    setFocusedId(next.id);
    rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
  }

  function decideFocused(action: "approve" | "deny") {
    const row = shown[focusedIndex];
    if (!row || row.status !== "pending") return;
    if (action === "approve" && !canApprove) return;
    if (action === "deny" && !canDeny) return;
    void act(row.id, action, row);
  }

  function onQueueKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target)) return;
    const action = queueKeyAction(event);
    if (!action) return;
    event.preventDefault();
    if (action === "next") moveFocus(1);
    else if (action === "prev") moveFocus(-1);
    else decideFocused(action);
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Elevation requests</h1>
          <p className="lede">
            Standard users asked to run something that is not on the always-allow list. Risk is scored from the
            binary, path, publisher, and arguments — not the filename alone. Policy admins can turn a row into an
            always-allow rule using the recorded hash and publisher; saving a rule never decides the request —
            approval stays separate, and you will be asked whether to approve a waiting row right after saving.
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
      <div className="filters">
        <button className={`ghost ${filter === "pending" ? "active" : ""}`} type="button" onClick={() => setFilter("pending")}>
          Pending queue
        </button>
        <button className={`ghost ${filter === "blocked" ? "active" : ""}`} type="button" onClick={() => setFilter("blocked")}>
          Pending and blocked
        </button>
        <button className={`ghost ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")}>
          All requests
        </button>
      </div>
      {error ? <p className="err" style={{ marginBottom: 12 }}>{error}</p> : null}
      <p className="lede" style={{ fontSize: 12, margin: "0 0 12px" }}>
        Keyboard: j/k navigate · a approve · d deny
      </p>
      <div className="panel" role="region" aria-label="Elevation request queue" tabIndex={0} onKeyDown={onQueueKeyDown}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>When</th>
              <th>Risk</th>
              <th>User / host</th>
              <th>Program</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.length ? (
              shown.map((row) => (
                <tr
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.id, el);
                    else rowRefs.current.delete(row.id);
                  }}
                  className={`queue-row ${row.id === focusedRowId ? "focused" : ""}`}
                >
                  <td><span className={`pill ${row.status}`}>{row.status}</span></td>
                  <td>
                    <div>{formatWhenShort(row.requestedAt)}</div>
                    {row.decidedBy ? <div className="mono">{row.status} by {row.decidedBy}</div> : null}
                  </td>
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
                    <div>{displayPath(row.filePath)}</div>
                    <div className="mono">{row.publisher}</div>
                    <div className="mono">{row.fileHash.slice(0, 16)}…</div>
                    {row.arguments ? <div className="mono">{row.arguments}</div> : null}
                  </td>
                  <td>
                    {row.status === "pending" && (canApprove || canDeny) ? (
                      <div className="row-actions">
                        {canApprove ? (
                          <button className="primary" disabled={busy === row.id} onClick={() => act(row.id, "approve", row)}>
                            Approve
                          </button>
                        ) : null}
                        {canDeny ? (
                          <button className="danger" disabled={busy === row.id} onClick={() => act(row.id, "deny", row)}>
                            Deny
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <AllowlistFromRequestButton
                      canManage={canManageAllowlists}
                      policies={policies}
                      requestId={row.id}
                      requestPending={row.status === "pending"}
                      canApproveRequest={canApprove}
                      source={{
                        filePath: row.filePath,
                        fileHash: row.fileHash,
                        publisher: row.publisher,
                        arguments: row.arguments,
                        hostname: row.hostname,
                        deviceId: row.deviceId,
                      }}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="lede" style={{ padding: 18 }}>
                  {filter === "pending"
                    ? "No pending elevations. Switch to pending and blocked to review denials and cancellations, or all requests for history."
                    : filter === "blocked"
                      ? "No pending, denied, or canceled elevations."
                      : "No elevation requests yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
