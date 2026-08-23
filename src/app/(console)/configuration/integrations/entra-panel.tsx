"use client";

import type { DeviceFlow, DirectoryStatus } from "./integrations-types";

export function EntraPanel({
  directory,
  deviceFlow,
  busy,
  onConnect,
  onSync,
}: {
  directory: DirectoryStatus;
  deviceFlow: DeviceFlow | null;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
}) {
  const connected = directory.connected === true ? directory : null;
  return (
    <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
      <strong>Microsoft Entra ID</strong>
      <p className="lede" style={{ fontSize: 13 }}>
        Cloud identity and portal SSO. Independent of Active Directory — use it alone, with AD
        (hybrid), or skip it.
      </p>
      {connected ? (
        <p className="lede">
          Connected to <span className="mono">{connected.tenantName || connected.tenantId}</span>
          {connected.lastSyncAt ? ` · last sync ${new Date(connected.lastSyncAt).toLocaleString()}` : ""}
          {connected.connectedBy ? ` · by ${connected.connectedBy}` : ""}
        </p>
      ) : (
        <p className="lede">Not connected. A Global Administrator sign-in is enough — no portal app registration.</p>
      )}
      {deviceFlow ? (
        <div className="device-code">
          <p className="lede">Open Microsoft sign-in and enter this code as Global Administrator:</p>
          <div className="device-code-value">{deviceFlow.userCode}</div>
          <a href={deviceFlow.verificationUri} target="_blank" rel="noreferrer">
            {deviceFlow.verificationUri}
          </a>
          <p className="lede" style={{ fontSize: 12 }}>
            Waiting for Microsoft… the directory app is created after you approve.
          </p>
        </div>
      ) : null}
      <div className="row-actions">
        {!connected && !deviceFlow ? (
          <button className="primary" type="button" disabled={busy} onClick={onConnect}>
            {busy ? "Starting…" : "Connect Entra ID"}
          </button>
        ) : null}
        {connected ? (
          <button className="primary" type="button" disabled={busy} onClick={onSync}>
            {busy ? "Syncing…" : "Sync Entra users & groups"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
