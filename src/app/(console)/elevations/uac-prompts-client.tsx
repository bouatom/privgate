"use client";

import { formatWhenShort } from "@/lib/format";
import type { Policy } from "@/lib/policy";
import { uacOutcomeLabel, uacOutcomePill, uacProgramLabel } from "@/lib/uac-prompt-label";
import { AllowlistFromRequestButton } from "../allowlist-from-request-button";

export type UacPromptView = {
  id: string;
  deviceId: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments: string;
  lastAt: string;
  count: number;
  lastOutcome: string;
  userName: string;
  hostname: string;
};

export function UacPromptsClient({
  rows,
  canManageAllowlists,
  policies,
  showHost = true,
  heading,
  lede,
}: {
  rows: UacPromptView[];
  canManageAllowlists: boolean;
  policies: Policy[];
  showHost?: boolean;
  heading?: string;
  lede?: string;
}) {
  const intro =
    lede ??
    (showHost
      ? "Stock Windows UAC prompts on enrolled PCs — including programs the user approved with their own or another person's credentials. Counts how often each program appeared so you can write allowlist rules before the next call. Hash and publisher are required to always-allow."
      : "");
  return (
    <>
      {heading ? <h2 className="section-title">{heading}</h2> : null}
      {intro ? <p className="lede" style={{ fontSize: 13, margin: heading ? "0 0 8px" : "0 0 12px" }}>{intro}</p> : null}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Times</th>
              <th>Last seen</th>
              <th>Outcome</th>
              {showHost ? <th>User / host</th> : <th>User</th>}
              <th>Program</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.count}</td>
                  <td className="mono">{formatWhenShort(row.lastAt)}</td>
                  <td>
                    <span className={`pill ${uacOutcomePill(row.lastOutcome)}`}>
                      {uacOutcomeLabel(row.lastOutcome)}
                    </span>
                  </td>
                  <td>
                    {row.userName}
                    {showHost ? <div className="mono">{row.hostname}</div> : null}
                  </td>
                  <td>
                    <div>{uacProgramLabel(row.filePath)}</div>
                    {row.publisher ? <div className="mono">{row.publisher}</div> : null}
                    {row.fileHash ? <div className="mono">{row.fileHash.slice(0, 16)}…</div> : null}
                    {row.arguments ? <div className="mono">{row.arguments}</div> : null}
                  </td>
                  <td>
                    <AllowlistFromRequestButton
                      canManage={canManageAllowlists}
                      policies={policies}
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
                  No stock UAC prompts have been reported yet. They appear when a standard user
                  is asked for elevated credentials on an enrolled PC running a current agent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
