"use client";

import type { Method } from "./device-methods";

/**
 * The "Deploy the Windows client" panel: installer choice grid, silent-install
 * hints, and the download action. Split out of devices-client to keep that
 * file on one domain (the fleet table).
 */
export function DeployPanel({
  method,
  onMethod,
  canInstall,
  msiReady,
  consoleUrl,
  error,
  onDownload,
}: {
  method: Method;
  onMethod: (method: Method) => void;
  canInstall: boolean;
  msiReady: boolean;
  consoleUrl: string;
  error: string;
  onDownload: () => void;
}) {
  return (
    <section className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
      <strong>Deploy the Windows client</strong>
      <p className="lede" style={{ fontSize: 13 }}>
        Choose one file. The management console address is already in it. You do not enroll names in advance,
        and you do not pick a join type.
      </p>
      <div className="choice-grid">
        <button
          type="button"
          className={method === "msi" ? "choice selected" : "choice"}
          aria-pressed={method === "msi"}
          disabled={!canInstall || !msiReady}
          onClick={() => onMethod("msi")}
        >
          <span className="k">Windows Installer</span>
          <h2>MSI</h2>
          <p>
            {msiReady
              ? "Intune, SCCM, NinjaOne, Group Policy, or a double-click on the PC. One branded .msi — not a zip."
              : "Not on this console. Reinstall the management console from GitHub Releases so the client MSI is included, or use the deployment script."}
          </p>
        </button>
        <button
          type="button"
          className={method === "script" ? "choice selected" : "choice"}
          aria-pressed={method === "script"}
          disabled={!canInstall}
          onClick={() => onMethod("script")}
        >
          <span className="k">PowerShell</span>
          <h2>Deployment script</h2>
          <p>
            Imaging, psexec, or a scheduled task. One <span className="mono">.ps1</span> file — not a zip.
            After install, <strong>PrivGate Client</strong> appears in Apps &amp; Features.
          </p>
        </button>
      </div>
      <p className="lede deploy-url">
        This installer will call <span className="mono">{consoleUrl}</span>
        {" "}(Configuration → Network). Download it from the same console you will enroll against.
      </p>
      {method === "msi" && msiReady ? (
        <p className="lede" style={{ fontSize: 13 }}>
          Silent install for Intune / SCCM / NinjaOne:{" "}
          <span className="mono">msiexec /i PrivGate-Client.msi /qn /norestart</span>
          . Uninstall from Apps &amp; Features or{" "}
          <span className="mono">msiexec /x {"{ProductCode}"} /qn</span>.
        </p>
      ) : null}
      {method === "script" ? (
        <p className="lede" style={{ fontSize: 13 }}>
          After install, uninstall from Apps &amp; Features (<span className="mono">PrivGate Client</span>
          ) or elevated{" "}
          <span className="mono">C:\Program Files\PrivGate\Uninstall-PrivGate.ps1</span>. Scripts
          downloaded before this change have no Apps entry — use the commands in the Windows VM lab doc.
        </p>
      ) : null}
      {error ? <p className="err">{error}</p> : null}
      <div className="row-actions">
        {canInstall ? (
          <button className="primary" type="button" onClick={onDownload}>
            {method === "msi" ? "Download MSI" : "Download deployment script"}
          </button>
        ) : (
          <p className="lede" style={{ fontSize: 12 }}>Policy admins can download the Windows client.</p>
        )}
      </div>
    </section>
  );
}
