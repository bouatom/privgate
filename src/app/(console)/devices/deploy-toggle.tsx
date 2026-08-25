"use client";

import { useState } from "react";
import type { Method } from "./device-methods";
import { DeployPanel } from "./deploy-panel";

/**
 * Compact deployment entry point for the Devices page: one row with the
 * installer method chips and the download action; the full choice grid and
 * silent-install hints stay available behind a small disclosure so the fleet
 * table gets the space. All degradation messaging (missing MSI / missing
 * client files) is preserved from the old always-open panel.
 */
export function DeployToggle({
  canInstall,
  msiReady,
  binariesReady,
  consoleUrl,
}: {
  canInstall: boolean;
  msiReady: boolean;
  binariesReady: boolean;
  consoleUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>(msiReady ? "msi" : "script");
  const [error, setError] = useState("");

  function download() {
    setError("");
    if (method === "msi" && !msiReady) {
      setError("MSI is not available here. Download the deployment script instead.");
      return;
    }
    if (!binariesReady) {
      setError(
        "This console is missing the Windows client. Reinstall from GitHub Releases, or from a source checkout run bash scripts/smoke-agent-build.sh and restart.",
      );
      return;
    }
    window.location.href = `/api/devices/client?format=${method}&apiBase=${encodeURIComponent(consoleUrl)}`;
  }

  return (
    <section className="panel" style={{ padding: 0, marginBottom: 16 }}>
      <div className="deploy-bar">
        <strong>Deploy Windows client</strong>
        {(["msi", "script"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={method === m ? "deploy-chip selected" : "deploy-chip"}
            aria-pressed={method === m}
            disabled={!canInstall || (m === "msi" && !msiReady)}
            title={m === "msi" && !msiReady ? "MSI not on this console — use the deployment script." : undefined}
            onClick={() => setMethod(m)}
          >
            {m === "msi" ? "MSI" : "Script"}
          </button>
        ))}
        {canInstall ? (
          <button
            className="primary"
            type="button"
            aria-label={`Download ${method === "msi" ? "MSI" : "deployment script"}`}
            onClick={download}
          >
            Download
          </button>
        ) : (
          <span className="lede" style={{ fontSize: 12 }}>Policy admins can download the Windows client.</span>
        )}
        {!binariesReady ? (
          <span className="pill pending" title={error || undefined}>
            client files missing
          </span>
        ) : null}
        {!msiReady ? <span className="pill canceled">no MSI here</span> : null}
        <button
          type="button"
          className="ghost icon-btn"
          style={{ marginLeft: "auto" }}
          aria-expanded={open}
          aria-controls="deploy-details"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide deploy options ▴" : "Deploy… ▾"}
        </button>
      </div>
      {error ? <p className="err" style={{ margin: "0 14px 10px" }}>{error}</p> : null}
      {open ? (
        <div id="deploy-details" className="stack" style={{ padding: "0 14px 14px" }}>
          <DeployPanel
            method={method}
            onMethod={setMethod}
            canInstall={canInstall}
            msiReady={msiReady}
            consoleUrl={consoleUrl}
          />
        </div>
      ) : null}
    </section>
  );
}
