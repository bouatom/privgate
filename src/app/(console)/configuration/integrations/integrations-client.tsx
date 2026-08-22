"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdSettings } from "@/lib/db";

type DirectoryStatus =
  | { connected: false }
  | {
      connected: true;
      tenantName: string;
      tenantId: string;
      lastSyncAt: string | null;
      connectedBy: string;
    };

type DeviceFlow = {
  state: string;
  userCode: string;
  verificationUri: string;
  interval: number;
};

export function IntegrationsClient({
  directory: initialDirectory,
  ad: initialAd,
}: {
  directory: DirectoryStatus;
  ad: AdSettings;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [directory, setDirectory] = useState<DirectoryStatus>(initialDirectory);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ad, setAd] = useState<AdSettings>(initialAd);
  const [adForm, setAdForm] = useState({
    host: initialAd.host,
    port: initialAd.port,
    useTls: initialAd.useTls,
    bindDn: initialAd.bindDn,
    password: "",
    baseDn: initialAd.baseDn,
    userFilter:
      initialAd.userFilter ||
      "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
  });
  const [importJson, setImportJson] = useState(
    '[{"displayName":"Sam Support","userPrincipalName":"sam@contoso.test","adSid":"S-1-5-21-1000-1000-1000-1102","jitEligible":true}]',
  );

  useEffect(() => {
    setDirectory(initialDirectory);
    setAd(initialAd);
  }, [initialDirectory, initialAd]);

  async function load() {
    const [dir, adRes] = await Promise.all([fetch("/api/directory"), fetch("/api/directory/ad")]);
    if (dir.ok) setDirectory(await dir.json());
    if (adRes.ok) {
      const body = (await adRes.json()) as AdSettings;
      setAd(body);
      setAdForm((prev) => ({
        ...prev,
        host: body.host,
        port: body.port,
        useTls: body.useTls,
        bindDn: body.bindDn,
        baseDn: body.baseDn,
        userFilter: body.userFilter || prev.userFilter,
        password: "",
      }));
    }
    startTransition(() => router.refresh());
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("entra") === "connected") setMessage("Entra ID connected and directory synced.");
    if (params.get("entra") === "error") setError(params.get("reason") || "Entra setup failed.");
  }, []);

  useEffect(() => {
    if (!deviceFlow) return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/setup/entra/device?state=${encodeURIComponent(deviceFlow.state)}`);
        const body = (await res.json()) as { status?: string; error?: string; tenantName?: string };
        if (body.status === "pending") return;
        setDeviceFlow(null);
        if (body.status === "connected") {
          setMessage(`Connected to ${body.tenantName || "Entra ID"} and synced users and groups.`);
          setError("");
          await load();
          return;
        }
        setError(body.error || "Entra sign-in did not finish.");
      })();
    }, Math.max(3, deviceFlow.interval || 5) * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceFlow]);

  async function connectEntra() {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/setup/entra/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = (await res.json()) as {
      mode?: string;
      url?: string;
      state?: string;
      userCode?: string;
      verificationUri?: string;
      interval?: number;
      error?: string;
      tenantName?: string;
    };
    setBusy(false);
    if (body.mode === "redirect" && body.url) {
      window.location.href = body.url;
      return;
    }
    if (body.mode === "device" && body.state && body.userCode && body.verificationUri) {
      setDeviceFlow({
        state: body.state,
        userCode: body.userCode,
        verificationUri: body.verificationUri,
        interval: body.interval || 5,
      });
      return;
    }
    if (body.mode === "connected") {
      setMessage(`Connected to ${body.tenantName || "Entra ID"}.`);
      await load();
      return;
    }
    setError(body.error || "Could not start Entra setup.");
  }

  async function syncNow() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/directory", { method: "POST" });
    const body = (await res.json()) as { error?: string; users?: number; groups?: number };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Sync failed");
      return;
    }
    setMessage(`Synced ${body.users ?? 0} users and ${body.groups ?? 0} groups.`);
    await load();
  }

  async function saveAd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/directory/ad", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(adForm),
    });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not save AD settings");
      return;
    }
    setMessage("Active Directory connection settings saved. Bind password is stored encrypted.");
    setAdForm((prev) => ({ ...prev, password: "" }));
    await load();
  }

  async function testAd() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/directory/ad", { method: "POST" });
    const body = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "AD connection test failed");
      await load();
      return;
    }
    setMessage("Reached the domain controller. User sync still uses Entra or JSON import until LDAP search is enabled for this bind.");
    await load();
  }

  async function importUsers(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    let usersPayload: unknown[];
    try {
      const parsed = JSON.parse(importJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("JSON must be an array of users.");
      usersPayload = parsed;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON.");
      return;
    }
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ users: usersPayload }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "Could not import users.");
      return;
    }
    setMessage("Directory users upserted.");
    startTransition(() => router.refresh());
  }

  const connected = directory?.connected === true ? directory : null;

  return (
    <>
      <div className="top">
        <div>
          <h1>Integrations</h1>
          <p className="lede">
            Connect Microsoft Entra ID and on-premises Active Directory. Entra sign-in as Global Administrator creates
            the Graph app. AD stores LDAP bind settings for hybrid identity.
          </p>
        </div>
      </div>

      <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
        <strong>Microsoft Entra ID</strong>
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
            <p className="lede" style={{ fontSize: 12 }}>Waiting for Microsoft… the directory app is created after you approve.</p>
          </div>
        ) : null}
        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        <div className="row-actions">
          {!connected && !deviceFlow ? (
            <button className="primary" type="button" disabled={busy} onClick={() => void connectEntra()}>
              {busy ? "Starting…" : "Connect Entra ID"}
            </button>
          ) : null}
          {connected ? (
            <button className="primary" type="button" disabled={busy} onClick={() => void syncNow()}>
              {busy ? "Syncing…" : "Sync users & groups"}
            </button>
          ) : null}
        </div>
      </div>

      <form className="panel stack" style={{ padding: 18, marginBottom: 16 }} onSubmit={saveAd}>
        <strong>Active Directory (LDAP)</strong>
        <p className="lede" style={{ fontSize: 13 }}>
          Point PrivGate at a domain controller. The bind password is encrypted at rest. Test checks that the host and
          port accept a connection (LDAPS 636 or LDAP 389).
        </p>
        {ad?.lastTestedAt ? (
          <p className="lede" style={{ fontSize: 12 }}>
            Last test {new Date(ad.lastTestedAt).toLocaleString()}
            {ad.lastError ? ` · ${ad.lastError}` : " · reachable"}
          </p>
        ) : null}
        <div className="grid cards">
          <div>
            <label>Domain controller</label>
            <input value={adForm.host} onChange={(e) => setAdForm({ ...adForm, host: e.target.value })} placeholder="dc01.contoso.test" />
          </div>
          <div>
            <label>Port</label>
            <input type="number" value={adForm.port} onChange={(e) => setAdForm({ ...adForm, port: Number(e.target.value) })} />
          </div>
          <div>
            <label>Base DN</label>
            <input value={adForm.baseDn} onChange={(e) => setAdForm({ ...adForm, baseDn: e.target.value })} placeholder="DC=contoso,DC=test" />
          </div>
        </div>
        <div className="grid cards">
          <div>
            <label>Bind DN or UPN</label>
            <input value={adForm.bindDn} onChange={(e) => setAdForm({ ...adForm, bindDn: e.target.value })} placeholder="CN=PrivGate,OU=Service,DC=contoso,DC=test" />
          </div>
          <div>
            <label>Bind password {ad?.passwordSet ? "(saved)" : ""}</label>
            <input type="password" value={adForm.password} onChange={(e) => setAdForm({ ...adForm, password: e.target.value })} placeholder={ad?.passwordSet ? "Leave blank to keep" : ""} autoComplete="new-password" />
          </div>
          <label className="choice" style={{ alignSelf: "end", marginBottom: 10 }}>
            <input type="checkbox" checked={adForm.useTls} onChange={(e) => setAdForm({ ...adForm, useTls: e.target.checked, port: e.target.checked ? 636 : 389 })} />
            Use TLS (LDAPS)
          </label>
        </div>
        <div>
          <label>User filter</label>
          <input value={adForm.userFilter} onChange={(e) => setAdForm({ ...adForm, userFilter: e.target.value })} />
        </div>
        <div className="row-actions">
          <button className="primary" type="submit" disabled={busy}>Save AD settings</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => void testAd()}>Test connection</button>
        </div>
      </form>

      <form className="panel stack" style={{ padding: 18 }} onSubmit={importUsers}>
        <strong>Manual JSON import</strong>
        <p className="lede" style={{ fontSize: 12 }}>Fallback if Entra is not connected yet, or to inject SIDs from an AD export.</p>
        <textarea rows={6} value={importJson} onChange={(e) => setImportJson(e.target.value)} />
        <button className="primary" type="submit">Upsert users</button>
      </form>
    </>
  );
}
