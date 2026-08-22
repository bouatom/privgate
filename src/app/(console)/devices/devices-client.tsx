"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type DeviceSummary = {
  id: string;
  hostname: string;
  joinType: string;
  enrolledAt: string;
  pendingRequests: number;
  activeJit: number;
  lastEventAt: string | null;
  lastAction: string | null;
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
  joinType: string;
  enrolledAt: string;
  events: EventRow[];
  requests: RequestRow[];
  jit: JitRow[];
};

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
}: {
  devices: DeviceSummary[];
  selected: string;
  detail: Detail | null;
  canInstall: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [host, setHost] = useState("");
  const [joinType, setJoinType] = useState("hybrid");
  const [apiBase, setApiBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedDevice = useMemo(() => devices.find((d) => d.id === selected), [devices, selected]);

  useEffect(() => {
    setApiBase((prev) => prev || window.location.origin);
  }, []);

  function selectDevice(id: string) {
    startTransition(() => router.push(`/devices?id=${encodeURIComponent(id)}`));
  }

  function downloadInstaller(id: string) {
    const url = `/api/devices/${id}/installer?apiBase=${encodeURIComponent(apiBase || window.location.origin)}`;
    window.location.href = url;
  }

  async function enroll(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: host, joinType }),
    });
    const body = (await res.json()) as { id?: string; error?: string };
    setBusy(false);
    if (!res.ok || !body.id) {
      setError(body.error || "Could not enroll device");
      return;
    }
    setHost("");
    startTransition(() => router.push(`/devices?id=${encodeURIComponent(body.id!)}`));
    downloadInstaller(body.id);
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Devices</h1>
          <p className="lede">
            Enroll a Windows PC, download its broker installer, and review elevation events on that host.
          </p>
        </div>
      </div>

      <form className="panel stack" style={{ padding: 18, marginBottom: 16 }} onSubmit={enroll}>
        <strong>Windows installer</strong>
        <p className="lede" style={{ fontSize: 13 }}>
          Enroll the hostname, then run <span className="mono">Install-PrivGate.ps1</span> elevated on the PC. The zip
          includes the device secret, control-plane URL, and agent source. It does not disable UAC.
        </p>
        <div className="grid cards">
          <div>
            <label>Hostname</label>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="LAB-W11-01" required />
          </div>
          <div>
            <label>Join type</label>
            <select value={joinType} onChange={(e) => setJoinType(e.target.value)}>
              <option value="hybrid">Hybrid AD + Entra</option>
              <option value="entra">Entra joined</option>
              <option value="ad">AD joined</option>
            </select>
          </div>
          <div>
            <label>Control plane URL the PC can reach</label>
            <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://192.168.1.10:3000" />
          </div>
        </div>
        {error ? <p className="err">{error}</p> : null}
        <div className="row-actions">
          {canInstall ? (
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Packaging…" : "Enroll and download installer"}
            </button>
          ) : (
            <p className="lede" style={{ fontSize: 12 }}>Policy admins can enroll devices and download installers.</p>
          )}
          {canInstall && selected ? (
            <button className="ghost" type="button" onClick={() => downloadInstaller(selected)}>
              Download installer for {selectedDevice?.hostname || "this device"}
            </button>
          ) : null}
        </div>
      </form>

      <div className="device-layout">
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr
                  key={d.id}
                  className={d.id === selected ? "device-row selected" : "device-row"}
                  onClick={() => selectDevice(d.id)}
                >
                  <td>
                    <div>{d.hostname}</div>
                    <div className="mono">{d.joinType}</div>
                    <div className="mono">{d.id}</div>
                  </td>
                  <td>
                    {d.pendingRequests ? <span className="pill pending">{d.pendingRequests} pending</span> : null}{" "}
                    {d.activeJit ? <span className="pill active">JIT</span> : null}
                    <div className="mono">{d.lastAction || "no events yet"}</div>
                    <div className="mono">{d.lastEventAt ? new Date(d.lastEventAt).toLocaleString() : "—"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          {detail ? (
            <>
              <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
                <strong>{detail.hostname}</strong>
                <p className="lede" style={{ fontSize: 13, marginTop: 6 }}>
                  Enrolled {new Date(detail.enrolledAt).toLocaleString()} · {detail.joinType}
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
                            <div>{row.filePath}</div>
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
              <p className="lede">Select a device to see its events.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
