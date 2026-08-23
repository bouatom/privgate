"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IDENTITY_MODE_COPY, identityMode } from "@/lib/identity-mode";
import type { AdSettings } from "@/lib/models";
import { AdPanel } from "./ad-panel";
import { EntraPanel } from "./entra-panel";
import type { AdFormState, DeviceFlow, DirectoryStatus } from "./integrations-types";
import { JsonImportPanel } from "./json-import-panel";

const DEFAULT_FILTER =
  "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))";

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
  const [adForm, setAdForm] = useState<AdFormState>({
    host: initialAd.host,
    port: initialAd.port,
    useTls: initialAd.useTls,
    bindDn: initialAd.bindDn,
    password: "",
    baseDn: initialAd.baseDn,
    userFilter: initialAd.userFilter || DEFAULT_FILTER,
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
    if (dir.ok) setDirectory((await dir.json()) as DirectoryStatus);
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

  async function syncEntra() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/directory", { method: "POST" });
    const body = (await res.json()) as { error?: string; users?: number; groups?: number };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Entra sync failed");
      return;
    }
    setMessage(`Entra sync: ${body.users ?? 0} users and ${body.groups ?? 0} groups.`);
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
    setMessage("Active Directory settings saved. Bind password is stored encrypted. Entra is unchanged.");
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
      setError(body.error || "AD LDAP bind failed");
      await load();
      return;
    }
    setMessage("LDAP bind succeeded. You can sync AD users without connecting Entra ID.");
    await load();
  }

  async function syncAd() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/directory/ad/sync", { method: "POST" });
    const body = (await res.json()) as { error?: string; users?: number };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "AD sync failed");
      await load();
      return;
    }
    setMessage(`AD sync: ${body.users ?? 0} users. Existing Entra object IDs were kept.`);
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

  const mode = identityMode({
    entraConnected: directory.connected === true,
    adConfigured: ad.configured,
  });
  const copy = IDENTITY_MODE_COPY[mode];

  return (
    <>
      <div className="top">
        <div>
          <h1>Integrations</h1>
          <p className="lede">
            Identity sources are independent. Connect on-premises Active Directory, Microsoft Entra
            ID, both (hybrid), or neither.
          </p>
        </div>
      </div>

      <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
        <strong>{copy.title}</strong>
        <p className="lede">{copy.body}</p>
        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="err">{error}</p> : null}
      </div>

      <EntraPanel
        directory={directory}
        deviceFlow={deviceFlow}
        busy={busy}
        onConnect={() => void connectEntra()}
        onSync={() => void syncEntra()}
      />
      <AdPanel
        ad={ad}
        adForm={adForm}
        setAdForm={setAdForm}
        busy={busy}
        onSave={(e) => void saveAd(e)}
        onTest={() => void testAd()}
        onSync={() => void syncAd()}
      />
      <JsonImportPanel importJson={importJson} setImportJson={setImportJson} onImport={(e) => void importUsers(e)} />
    </>
  );
}
