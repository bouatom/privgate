"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { displayPath } from "@/lib/format";

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

type EventRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
};

type RequestRow = {
  id: string;
  status: string;
  filePath: string;
  publisher: string;
  userName: string;
  requestedAt: string;
  riskLevel: string;
  riskReasons: string;
};

type JitRow = {
  id: string;
  status: string;
  durationMinutes: number;
  reason: string;
  expiresAt: string;
  userName: string;
};

type Detail = {
  id: string;
  hostname: string;
  enrolledAt: string;
  events: EventRow[];
  requests: RequestRow[];
  jit: JitRow[];
};

type Method = "msi" | "script";

function reasonsOf(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function DevicesClient({
  devices,
  selected,
  detail,
  canInstall,
  consoleUrl,
  binariesReady,
  msiReady,
}: {
  devices: DeviceSummary[];
  selected: string;
  detail: Detail | null;
  canInstall: boolean;
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
                ? "Intune, Group Policy, or a double-click on the PC. One .msi file — not a zip."
                : "Not available on this console. Use the deployment script. GitHub Releases console builds include the client MSI."}
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
            <p>Imaging, psexec, or a scheduled task. One <span className="mono">.ps1</span> file — not a zip.</p>
          </button>
        </div>
        <p className="lede deploy-url">
          This installer will call <span className="mono">{consoleUrl}</span>
          {" "}(Configuration → Network).
        </p>
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
            <>
              <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
                <strong>{detail.hostname}</strong>
                <p className="lede" style={{ fontSize: 13, marginTop: 6 }}>
                  First seen {new Date(detail.enrolledAt).toLocaleString()}
                </p>
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
                            <div className="mono">{JSON.stringify(row.details)}</div>
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
              <h2 className="section-title">Elevation requests</h2>
              <div className="panel" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Risk</th>
                      <th>Program</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.requests.length ? (
                      detail.requests.map((row) => (
                        <tr key={row.id}>
                          <td><span className={`pill ${row.status}`}>{row.status}</span></td>
                          <td>
                            <span className={`pill risk-${row.riskLevel}`}>{row.riskLevel}</span>
                            <ul className="risk-reasons">
                              {reasonsOf(row.riskReasons).map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            <div>{displayPath(row.filePath)}</div>
                            <div className="mono">{row.userName}</div>
                            <div className="mono">{row.publisher}</div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="lede" style={{ padding: 18 }}>
                          No elevation requests on this host.
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
                          <td><span className={`pill ${row.status}`}>{row.status}</span></td>
                          <td>{row.userName}</td>
                          <td>
                            <div>{row.durationMinutes} min · {row.reason}</div>
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
