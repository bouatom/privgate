"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Policy } from "@/lib/policy";
import { DeviceDetail, type DeviceDetailModel } from "./device-detail";

type DeviceSummary = {
  id: string;
  hostname: string;
  enrolledAt: string;
  pendingRequests: number;
  activeJit: number;
  lastEventAt: string | null;
  lastAction: string | null;
  online: boolean;
};

type Method = "msi" | "script";

export function DevicesClient({
  devices,
  selected,
  detail,
  canInstall,
  canManageAllowlists,
  policies,
  consoleUrl,
  binariesReady,
  msiReady,
}: {
  devices: DeviceSummary[];
  selected: string;
  detail: DeviceDetailModel | null;
  canInstall: boolean;
  canManageAllowlists: boolean;
  policies: Policy[];
  consoleUrl: string;
  binariesReady: boolean;
  msiReady: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [method, setMethod] = useState<Method>(msiReady ? "msi" : "script");
  const [error, setError] = useState("");

  const selectedDevice = useMemo(() => devices.find((d) => d.id === selected), [devices, selected]);

  function selectDevice(id: string) {
    startTransition(() => router.push(`/devices?id=${encodeURIComponent(id)}`));
  }

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
    <>
      <div className="top">
        <div>
          <h1>Devices</h1>
          <p className="lede">
            Install the Windows client. Each PC registers itself and shows up here as its hostname.
          </p>
        </div>
      </div>

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
            onClick={() => setMethod("msi")}
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
            onClick={() => setMethod("script")}
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
            <button className="primary" type="button" onClick={download}>
              {method === "msi" ? "Download MSI" : "Download deployment script"}
            </button>
          ) : (
            <p className="lede" style={{ fontSize: 12 }}>Policy admins can download the Windows client.</p>
          )}
        </div>
      </section>

      <div className="device-layout">
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {devices.length ? (
                devices.map((d) => (
                  <tr
                    key={d.id}
                    className={d.id === selected ? "device-row selected" : "device-row"}
                    onClick={() => selectDevice(d.id)}
                  >
                    <td>
                      <div>
                        {d.hostname}{" "}
                        {d.online ? <span className="pill active">live</span> : <span className="pill">offline</span>}
                      </div>
                    </td>
                    <td>
                      {d.pendingRequests ? <span className="pill pending">{d.pendingRequests} pending</span> : null}{" "}
                      {d.activeJit ? <span className="pill active">JIT</span> : null}
                      <div className="mono">{d.lastAction || "waiting for this PC"}</div>
                      <div className="mono">{d.lastEventAt ? new Date(d.lastEventAt).toLocaleString() : "—"}</div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="lede" style={{ padding: 18 }}>
                    No clients yet. After you install the MSI or script, the computer appears here as its hostname.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          {detail ? (
            <DeviceDetail
              detail={detail}
              policies={policies}
              canManageAllowlists={canManageAllowlists}
            />
          ) : (
            <div className="panel" style={{ padding: 18 }}>
              <p className="lede">
                {selectedDevice
                  ? `Select ${selectedDevice.hostname} again if detail did not load.`
                  : "Install a client to see that computer here."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
