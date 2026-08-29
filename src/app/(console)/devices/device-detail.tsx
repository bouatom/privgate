"use client";

import { useMemo, useState } from "react";
import { displayPath, formatDetails } from "@/lib/format";
import type { Policy } from "@/lib/policy";
import { AllowlistFromRequestButton } from "../allowlist-from-request-button";
import { UacPromptsClient, type UacPromptView } from "../elevations/uac-prompts-client";
import { UpdatePolicyControl } from "./update-policy-control";

export type DeviceEventRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
};

export type DeviceRequestRow = {
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
  decidedBy: string | null;
  riskLevel: string;
  riskReasons: string;
};

export type DeviceJitRow = {
  id: string;
  status: string;
  durationMinutes: number;
  reason: string;
  expiresAt: string;
  userName: string;
};

export type DeviceDetailModel = {
  id: string;
  hostname: string;
  enrolledAt: string;
  lastIp: string;
  agentVersion: string;
  events: DeviceEventRow[];
  requests: DeviceRequestRow[];
  uacPrompts: UacPromptView[];
  jit: DeviceJitRow[];
  /** Device-level update policy: '' means inherit from group / default. */
  updateMode: string;
  /** Daily scheduled time 'HH:MM' when updateMode === 'scheduled'. */
  updateSchedule: string;
  /** Effective policy resolved by the server (device > group > default). */
  effMode: string;
  effSchedule: string;
  effSource: "device" | "group" | "default";
  effSourceName?: string;
};

function reasonsOf(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function DeviceDetail({
  detail,
  policies,
  canManageAllowlists,
  canApproveRequests = false,
  canUpdate = false,
}: {
  detail: DeviceDetailModel;
  policies: Policy[];
  canManageAllowlists: boolean;
  /** Enables the "Rule saved — also approve?" follow-up for pending request rows. */
  canApproveRequests?: boolean;
  /** Enables the per-device update-policy override control. */
  canUpdate?: boolean;
}) {
  const [logFilter, setLogFilter] = useState<"blocked" | "all">("blocked");
  const blocked = useMemo(
    () =>
      detail.requests.filter(
        (row) => row.status === "pending" || row.status === "denied" || row.status === "canceled",
      ),
    [detail.requests],
  );
  const shown = logFilter === "blocked" ? blocked : detail.requests;

  return (
    <>
      <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
        <strong>{detail.hostname}</strong>
        <p className="lede" style={{ fontSize: 13, marginTop: 6 }}>
          First seen {new Date(detail.enrolledAt).toLocaleString()}
          {detail.lastIp ? (
            <>
              {" · IP "}
              <span className="mono">{detail.lastIp}</span>
            </>
          ) : null}
          {detail.agentVersion ? (
            <>
              {" · agent "}
              <span className="mono">v{detail.agentVersion.replace("+pending", " (updating…)")}</span>
            </>
          ) : null}
        </p>
      </div>
      {canUpdate ? (
        <UpdatePolicyControl
          deviceId={detail.id}
          hostname={detail.hostname}
          deviceMode={detail.updateMode}
          deviceSchedule={detail.updateSchedule}
          effMode={detail.effMode}
          effSchedule={detail.effSchedule}
          effSource={detail.effSource}
          effSourceName={detail.effSourceName}
        />
      ) : null}
      <h2 className="section-title">Could not elevate</h2>
      <p className="lede" style={{ fontSize: 13, marginBottom: 8 }}>
        Programs this PC asked to run elevated through PrivGate that were not always-allow. Always-allow
        copies the recorded hash, publisher, and arguments — not the filename alone.
      </p>
      <div className="filters" style={{ marginBottom: 8 }}>
        <button
          className={`ghost ${logFilter === "blocked" ? "active" : ""}`}
          type="button"
          onClick={() => setLogFilter("blocked")}
        >
          Pending and blocked
        </button>
        <button
          className={`ghost ${logFilter === "all" ? "active" : ""}`}
          type="button"
          onClick={() => setLogFilter("all")}
        >
          Full history
        </button>
      </div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>When</th>
              <th>Program</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.length ? (
              shown.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={`pill ${row.status}`}>{row.status}</span>
                    <div>
                      <span className={`pill risk-${row.riskLevel}`}>{row.riskLevel}</span>
                    </div>
                    {row.decidedBy ? <div className="mono">{row.decidedBy}</div> : null}
                  </td>
                  <td className="mono">{new Date(row.requestedAt).toLocaleString()}</td>
                  <td>
                    <div>{displayPath(row.filePath)}</div>
                    <div className="mono">{row.userName}</div>
                    <div className="mono">{row.publisher}</div>
                    <div className="mono">{row.fileHash.slice(0, 16)}…</div>
                    {row.arguments ? <div className="mono">{row.arguments}</div> : null}
                    <ul className="risk-reasons">
                      {reasonsOf(row.riskReasons).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <AllowlistFromRequestButton
                      canManage={canManageAllowlists}
                      policies={policies}
                      requestId={row.id}
                      requestPending={row.status === "pending"}
                      canApproveRequest={canApproveRequests}
                      source={{
                        filePath: row.filePath,
                        fileHash: row.fileHash,
                        publisher: row.publisher,
                        arguments: row.arguments,
                        hostname: row.hostname || detail.hostname,
                        deviceId: row.deviceId || detail.id,
                      }}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="lede" style={{ padding: 18 }}>
                  {logFilter === "blocked"
                    ? "Nothing pending or blocked on this PC. Switch to full history to see approved elevations."
                    : "No elevation attempts have reached PrivGate on this host yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginBottom: 16 }}>
        <UacPromptsClient
          heading="Windows UAC prompts"
          lede="Stock Windows credential prompts on this PC, including Start menu and Explorer. Counts how often each program appeared — including when the user typed admin credentials themselves."
          rows={detail.uacPrompts}
          canManageAllowlists={canManageAllowlists}
          policies={policies}
          showHost={false}
        />
      </div>
      <h2 className="section-title">Events</h2>
      <div className="panel" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {detail.events.length ? (
              detail.events.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{new Date(row.at).toLocaleString()}</td>
                  <td>{row.action}</td>
                  <td>
                    <div className="mono">{row.actor}</div>
                    <div className="mono">{row.target}</div>
                    {formatDetails(row.details) ? <div className="mono">{formatDetails(row.details)}</div> : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="lede" style={{ padding: 18 }}>
                  No audit events for this device yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2 className="section-title">JIT windows</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>User</th>
              <th>Window</th>
            </tr>
          </thead>
          <tbody>
            {detail.jit.length ? (
              detail.jit.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={`pill ${row.status}`}>{row.status}</span>
                  </td>
                  <td>{row.userName}</td>
                  <td>
                    <div>
                      {row.durationMinutes} min · {row.reason}
                    </div>
                    <div className="mono">until {new Date(row.expiresAt).toLocaleString()}</div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="lede" style={{ padding: 18 }}>
                  No JIT grants on this host.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
