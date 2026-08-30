"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../../_components/confirm-dialog";

export type CheckView = {
  available: boolean;
  version: string | null;
  assetName: string | null;
  releaseUrl: string;
  prerelease: boolean;
  checkedAt: string | null;
  error: string | null;
  channel: "official" | "nightly";
};

export type ApplyView = {
  phase: "idle" | "running" | "stale" | "succeeded" | "failed";
  target: string | null;
  startedAt: string | null;
  lastLines: string[];
  /** Where to look next; names the on-server log file for stale/failed runs. */
  hint: string | null;
  abandonable?: boolean;
};

type StatusBody = {
  installed: { version: string; source: string };
  channel: "official" | "nightly";
  check: CheckView | null;
  apply: ApplyView;
};

const APPLY_PHASE_LABEL: Record<ApplyView["phase"], string> = {
  idle: "No update has been applied from this console yet.",
  running: "Update in progress — the console service will restart. This page recovers on its own.",
  stale:
    "The last update never reported an outcome. You can abandon it here and click Update again — no server login is required.",
  succeeded: "The last update completed successfully.",
  failed:
    "The last update failed. The console verifies the release before replacing any files, so a checksum failure leaves your current version untouched. If it failed later in the process, the console may be partially updated — review the apply log and then try again.",
};

export function UpdatesClient({
  canManage,
  channel: initialChannel,
  installed,
  updaterPresent,
  initialCheck,
  initialApply,
}: {
  canManage: boolean;
  channel: "official" | "nightly";
  installed: { version: string; source: string };
  updaterPresent: boolean;
  initialCheck: CheckView | null;
  initialApply: ApplyView;
}) {
  const [channel, setChannel] = useState(initialChannel);
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [apply, setApply] = useState<ApplyView>(initialApply);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { confirm, dialog } = useConfirm();

  const check = status?.check ?? initialCheck;

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/configuration/update/status");
    if (!res.ok) return;
    const body = (await res.json()) as StatusBody;
    setStatus(body);
    setApply(body.apply);
  }, []);

  useEffect(() => {
    if (apply.phase !== "running") return;
    pollRef.current = setInterval(() => void refreshStatus(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [apply.phase, refreshStatus]);

  async function saveChannel(next: "official" | "nightly") {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/configuration/update/channel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not save the channel");
      return;
    }
    setChannel(next);
    setMessage(`Update channel set to ${next}. Checking GitHub for ${next} releases…`);
    await refreshStatus();
  }

  async function checkNow() {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/configuration/update/status", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as StatusBody & { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Check failed");
      return;
    }
    setStatus(body);
    setApply(body.apply);
    setMessage(body.check?.available ? `Version ${body.check.version} is available.` : "You are up to date.");
  }

  async function applyUpdate() {
    const target = check?.version;
    if (!target) return;
    const confirmed = await confirm({
      title: `Install PrivGate ${target} now?`,
      body: "The console service stops, swaps files, and restarts. Open admin sessions end.",
      confirmLabel: "Install now",
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setMessage("Downloading and verifying… this page shows progress from the server log.");
    setApply({
      phase: "running",
      target,
      startedAt: new Date().toISOString(),
      lastLines: [],
      hint: null,
      abandonable: true,
    });
    const res = await fetch("/api/configuration/update/apply", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { started?: boolean; target?: string; error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not start the update");
      setMessage("");
      await refreshStatus();
      return;
    }
    setMessage(`Updater launched for ${body.target}. The console will be briefly offline and come back on the new version.`);
    await refreshStatus();
  }

  async function abandonApply() {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/configuration/update/apply", { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not clear the stuck update");
      return;
    }
    setMessage("Cleared the stuck update lock. You can click Update again.");
    await refreshStatus();
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Updates</h1>
          <p className="lede">
            Keep this management console current. The console checks GitHub for a newer release every six hours and
            shows a badge here and in the side pane when one exists.
          </p>
        </div>
      </div>

      <form
        className="panel stack"
        style={{ padding: 18, marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void saveChannel(channel);
        }}
      >
        <strong>Release channel</strong>
        <label className="choice">
          <input type="radio" name="channel" checked={channel === "official"} onChange={() => setChannel("official")} />
          Official — stable releases only. Recommended.
        </label>
        <label className="choice">
          <input type="radio" name="channel" checked={channel === "nightly"} onChange={() => setChannel("nightly")} />
          Nightly — pre-release builds published first, ahead of official. Expect rough edges.
        </label>
        <p className="lede" style={{ fontSize: 13, margin: 0 }}>
          Nightlies use three-segment versions (<span className="mono">0.2.13</span>) and are published as GitHub{" "}
          <em>prereleases</em>; officials are regular non-prerelease releases of the same versioning scheme. Switching
          channels changes which upgrade path the console follows — it does not downgrade automatically.
        </p>
        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        <div className="row-actions">
          <button className="primary" type="submit" disabled={busy || !canManage || channel === (status?.channel ?? initialChannel)}>
            Save channel
          </button>
          {!canManage ? <span className="lede" style={{ fontSize: 12 }}>Your role cannot change update settings.</span> : null}
        </div>
      </form>

      <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
        <strong>Installed version</strong>
        <table>
          <tbody>
            <tr>
              <td>Console version</td>
              <td className="mono">{installed.version}</td>
            </tr>
            <tr>
              <td>Source</td>
              <td>
                <span className="mono">{installed.source}</span> — written at build time into the payload
                (<span className="mono">version.json</span>)
              </td>
            </tr>
            <tr>
              <td>Last check</td>
              <td>{check?.checkedAt ? new Date(check.checkedAt).toLocaleString() : "not since boot"}</td>
            </tr>
          </tbody>
        </table>
        <div className="row-actions">
          <button className="ghost" type="button" disabled={busy} onClick={() => void checkNow()}>
            Check now
          </button>
        </div>
      </div>

      <div className="panel stack" style={{ padding: 18 }}>
        <strong>Available update</strong>
        {check?.available && check.version ? (
          <>
            <p className="lede" style={{ margin: 0 }}>
              Version <span className="mono">{check.version}</span>{" "}
              {check.prerelease ? "(pre-release)" : ""} is available on the{" "}
              <span className="mono">{check.channel}</span> channel{check.assetName ? (
                <> as <span className="mono">{check.assetName}</span></>
              ) : null}.
              {check.releaseUrl ? <> <a href={check.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>.</> : null}
            </p>
            <div className="row-actions">
              <button className="primary" type="button" disabled={busy || !canManage || !updaterPresent} onClick={() => void applyUpdate()}>
                Update to {check.version}
              </button>
              {apply.abandonable && canManage ? (
                <button className="ghost" type="button" disabled={busy} onClick={() => void abandonApply()}>
                  Abandon stuck update
                </button>
              ) : null}
              {!updaterPresent ? (
                <span className="lede" style={{ fontSize: 12 }}>Updater script not found in this install (dev checkout?).</span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="lede" style={{ margin: 0 }}>
            {check?.error
              ? `Last check failed: ${check.error}.`
              : "Nothing newer found for the selected channel."}
          </p>
        )}
      </div>

      {apply.phase !== "idle" ? (
        <div
          className={`panel stack ${apply.phase === "failed" ? "danger" : ""}`}
          style={{ padding: 18, marginTop: 16 }}
        >
          <strong>{apply.phase === "failed" ? "Last apply failed" : "Last apply"}</strong>
          <p
            className={apply.phase === "failed" ? "err" : "lede"}
            style={{ fontSize: 13, margin: 0 }}
          >
            Target <span className="mono">{apply.target ?? "?"}</span>. {APPLY_PHASE_LABEL[apply.phase]}
          </p>
          {apply.hint ? (
            <p className="lede" style={{ fontSize: 13, margin: 0 }}>
              {apply.hint}
            </p>
          ) : null}
          {apply.lastLines.length > 0 ? (
            <details style={{ marginTop: 8 }}>
              <summary className="lede" style={{ cursor: "pointer", fontSize: 13 }}>
                View apply log ({apply.lastLines.length} {apply.lastLines.length === 1 ? "line" : "lines"})
              </summary>
              <pre
                style={{
                  maxHeight: 220,
                  overflow: "auto",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  marginTop: 8,
                }}
              >
                {apply.lastLines
                  .filter((l) => !/cmdline: powershell -encodedcommand/i.test(l))
                  .join("\n") || "(apply log is empty)"}
              </pre>
            </details>
          ) : null}
          {apply.abandonable && canManage && !(check?.available && check.version) ? (
            <div className="row-actions">
              <button className="ghost" type="button" disabled={busy} onClick={() => void abandonApply()}>
                Abandon stuck update
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {dialog}
    </>
  );
}
