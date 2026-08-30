"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../../_components/confirm-dialog";

export type ServerApplyView = {
  phase: "idle" | "running" | "stale" | "succeeded" | "failed";
  target: Target | null;
  startedAt: string | null;
  lastLines: string[];
  /** Where to look next; names the on-server log file for stale/failed runs. */
  hint: string | null;
  abandonable?: boolean;
};

type StatusBody = {
  current: { bind: string; webPort: number; agentPort: number; splitPorts: boolean };
  apply: ServerApplyView;
  lanUrls: string[];
};

type Target = { bind: string; webPort: number; agentPort: number };

const APPLY_PHASE_LABEL: Record<ServerApplyView["phase"], string> = {
  idle: "No server settings change has been applied from this console yet.",
  running:
    "Restart in progress — the console service is coming back up. When the port is unchanged this page recovers on its own.",
  stale:
    "The last change never reported an outcome. You can abandon it here and apply again — no server login is required.",
  succeeded: "The last change was applied and the console came back healthy.",
  failed:
    "The last change failed. The console backs up its configuration before writing anything and restores it if the console does not come back healthy, so your previous settings should be in effect. Review the apply log and try again.",
};

function bindKind(bind: string): "wildcard" | "loopback" | "custom" {
  if (/^(0\.0\.0\.0|::|\[::\])$/.test(bind)) return "wildcard";
  if (/^(127\.0\.0\.1|::1|localhost)$/.test(bind)) return "loopback";
  return "custom";
}

function parsePort(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function describeLocal(t: Target): string {
  return t.agentPort === t.webPort ? `${t.bind}:${t.webPort}` : `${t.bind}:${t.webPort} (broker ${t.agentPort})`;
}

function hostFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/([^/:]+)/);
  return m ? m[1] : null;
}

export function NetworkClient({
  canManage,
  bind,
  webPort,
  agentPort,
  lanUrls,
  initialApply,
}: {
  canManage: boolean;
  bind: string;
  webPort: number;
  agentPort: number;
  lanUrls: string[];
  initialApply: ServerApplyView;
}) {
  const [bindMode, setBindMode] = useState<"wildcard" | "loopback" | "custom">(bindKind(bind));
  const [customBind, setCustomBind] = useState(bindKind(bind) === "custom" ? bind : "");
  const [webPortValue, setWebPortValue] = useState(String(webPort));
  const [agentPortValue, setAgentPortValue] = useState(String(agentPort));
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [apply, setApply] = useState<ServerApplyView>(initialApply);
  const [lastTarget, setLastTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { confirm, dialog } = useConfirm();

  const effectiveBind =
    bindMode === "custom" ? customBind.trim() : bindMode === "loopback" ? "127.0.0.1" : "0.0.0.0";
  const webPortNum = parsePort(webPortValue);
  const agentPortNum = parsePort(agentPortValue);
  const bindValid =
    effectiveBind.length > 0 && effectiveBind.length <= 253 && !/\s/.test(effectiveBind);
  const valid = bindValid && webPortNum !== null && agentPortNum !== null;

  const landedHost =
    lanUrls.length > 0 && !/127\.0\.0\.1/.test(lanUrls[0]) ? hostFromUrl(lanUrls[0]) : null;
  const previewHost =
    bindMode === "loopback" ? "127.0.0.1" : bindMode === "custom" ? (bindValid ? effectiveBind : "…") : (landedHost ?? "this machine's LAN address");
  const changed =
    valid && (effectiveBind !== bind || webPortNum !== webPort || agentPortNum !== agentPort);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/configuration/server");
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

  const portChanging =
    apply.phase === "running" &&
    lastTarget !== null &&
    status !== null &&
    lastTarget.webPort !== status.current.webPort;

  async function applySettings() {
    if (!valid || !changed) return;
    const confirmed = await confirm({
      title: "Apply these server settings?",
      body: "The console service restarts, and open admin sessions end. If the console does not come back healthy, the previous settings are restored automatically.",
      confirmLabel: "Apply & restart",
    });
    if (!confirmed) return;
    const target: Target = { bind: effectiveBind, webPort: webPortNum!, agentPort: agentPortNum! };
    setBusy(true);
    setError("");
    setMessage("");
    setLastTarget(target);
    setApply({
      phase: "running",
      target,
      startedAt: new Date().toISOString(),
      lastLines: [],
      hint: null,
      abandonable: true,
    });
    const res = await fetch("/api/configuration/server/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
    });
    const body = (await res.json().catch(() => ({}))) as { started?: boolean; target?: string; error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not start the change");
      setMessage("");
      await refreshStatus();
      return;
    }
    setMessage("Restarting the console… it is briefly offline and comes back on the new address.");
    await refreshStatus();
  }

  async function abandonApply() {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/configuration/server/apply", { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not clear the stuck change");
      return;
    }
    setMessage("Cleared the stuck server settings change. You can apply again.");
    await refreshStatus();
  }

  return (
    <>
      <form
        className="panel stack"
        style={{ padding: 18, marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void applySettings();
        }}
      >
        <strong>Where the console listens</strong>
        <p className="lede" style={{ fontSize: 13, margin: 0 }}>
          Applying changes restarts the console service. The configuration file is backed up first
          and restored automatically if the console does not come back healthy.
        </p>

        <label className="lede" style={{ fontSize: 13, marginTop: 12 }}>
          Bind address
        </label>
        <select
          value={bindMode}
          onChange={(e) => setBindMode(e.target.value as typeof bindMode)}
          style={{ maxWidth: 420 }}
        >
          <option value="wildcard">All interfaces (0.0.0.0)</option>
          <option value="loopback">Loopback only (127.0.0.1)</option>
          <option value="custom">Custom address…</option>
        </select>
        {bindMode === "custom" ? (
          <input
            type="text"
            value={customBind}
            onChange={(e) => setCustomBind(e.target.value)}
            placeholder="e.g. 192.168.1.20"
            style={{ maxWidth: 420 }}
            autoFocus
          />
        ) : null}
        {!bindValid ? (
          <p className="err" style={{ fontSize: 13, margin: 0 }}>
            Enter a bind address without spaces (up to 253 characters).
          </p>
        ) : null}

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <label className="lede" style={{ fontSize: 13 }}>
            Management console port
            <input
              type="number"
              min={1}
              max={65535}
              value={webPortValue}
              onChange={(e) => setWebPortValue(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
          <label className="lede" style={{ fontSize: 13 }}>
            Broker connection port
            <input
              type="number"
              min={1}
              max={65535}
              value={agentPortValue}
              onChange={(e) => setAgentPortValue(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
        </div>
        {webPortNum === null || agentPortNum === null ? (
          <p className="err" style={{ fontSize: 13, margin: 0 }}>
            Ports must be whole numbers between 1 and 65535.
          </p>
        ) : null}

        {valid ? (
          <p className="lede" style={{ fontSize: 13, margin: 0 }}>
            Console opens at <span className="mono">http://{previewHost}:{webPortValue}</span>
            {agentPortNum !== webPortNum ? (
              <> · broker listens on <span className="mono">{agentPortValue}</span></>
            ) : null}
            {changed ? null : " · unchanged"}
          </p>
        ) : null}
        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button
            className="primary"
            type="submit"
            disabled={busy || !canManage || !valid || !changed}
            title={changed ? undefined : "Nothing has changed yet."}
          >
            Apply changes
          </button>
          {apply.abandonable && canManage ? (
            <button className="ghost" type="button" disabled={busy} onClick={() => void abandonApply()}>
              Abandon stuck change
            </button>
          ) : null}
          {!canManage ? (
            <span className="lede" style={{ fontSize: 12 }}>
              Only Master Admins can change server settings.
            </span>
          ) : null}
        </div>
      </form>

      {apply.phase !== "idle" ? (
        <div
          className={`panel stack ${apply.phase === "failed" ? "danger" : ""}`}
          style={{ padding: 18, marginBottom: 16 }}
        >
          <strong>{apply.phase === "failed" ? "Last change failed" : "Last change"}</strong>
          <p className={apply.phase === "failed" ? "err" : "lede"} style={{ fontSize: 13, margin: 0 }}>
            Target <span className="mono">{apply.target ? describeLocal(apply.target) : "?"}</span>. {APPLY_PHASE_LABEL[apply.phase]}
          </p>
          {portChanging ? (
            <p className="err" style={{ fontSize: 13, margin: 0 }}>
              The console restarts on port <span className="mono">{lastTarget!.webPort}</span> — this page is loaded
              on port <span className="mono">{status!.current.webPort}</span>. When the console is healthy again, open{" "}
              <span className="mono">http://{previewHost}:{lastTarget!.webPort}</span>.
            </p>
          ) : null}
          {apply.phase === "succeeded" && status && status.lanUrls.length > 0 ? (
            <p className="lede" style={{ fontSize: 13, margin: 0 }}>
              Now reachable at <span className="mono">{status.lanUrls.join(", ")}</span>
            </p>
          ) : null}
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
                {apply.lastLines.join("\n") || "(apply log is empty)"}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {dialog}
    </>
  );
}