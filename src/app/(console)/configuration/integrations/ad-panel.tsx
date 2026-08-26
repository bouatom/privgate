"use client";

import type { FormEvent } from "react";
import type { AdSettings } from "@/lib/models";
import type { AdFormState } from "./integrations-types";

export function AdPanel({
  ad,
  adForm,
  setAdForm,
  busy,
  onSave,
  onTest,
  onSync,
}: {
  ad: AdSettings;
  adForm: AdFormState;
  setAdForm: (next: AdFormState) => void;
  busy: boolean;
  onSave: (e: FormEvent) => void;
  onTest: () => void;
  onSync: () => void;
}) {
  return (
    <form className="panel stack" style={{ padding: 18, marginBottom: 16 }} onSubmit={onSave}>
      <strong>Active Directory (LDAP)</strong>
      <p className="lede" style={{ fontSize: 13 }}>
        On-premises AD only — syncs users and security groups. These settings are not used for
        Entra ID. Use AD alone, with Entra (hybrid), or skip it.
      </p>
      {ad.lastTestedAt ? (
        <p className="lede" style={{ fontSize: 12 }}>
          Last bind test {new Date(ad.lastTestedAt).toLocaleString()}
          {ad.lastError ? ` · ${ad.lastError}` : " · succeeded"}
        </p>
      ) : null}
      {ad.lastSyncAt ? (
        <p className="lede" style={{ fontSize: 12 }}>
          Last AD sync {new Date(ad.lastSyncAt).toLocaleString()}
        </p>
      ) : null}
      <div className="grid cards">
        <div>
          <label>Domain controller</label>
          <input
            value={adForm.host}
            onChange={(e) => setAdForm({ ...adForm, host: e.target.value })}
            placeholder="dc01.contoso.test"
          />
        </div>
        <div>
          <label>Port</label>
          <input
            type="number"
            value={adForm.port}
            onChange={(e) => setAdForm({ ...adForm, port: Number(e.target.value) })}
          />
        </div>
        <div>
          <label>Base DN</label>
          <input
            value={adForm.baseDn}
            onChange={(e) => setAdForm({ ...adForm, baseDn: e.target.value })}
            placeholder="DC=contoso,DC=test"
          />
        </div>
      </div>
      <div className="grid cards">
        <div>
          <label>Bind DN or UPN</label>
          <input
            value={adForm.bindDn}
            onChange={(e) => setAdForm({ ...adForm, bindDn: e.target.value })}
            placeholder="CN=PrivGate,OU=Service,DC=contoso,DC=test"
          />
        </div>
        <div>
          <label>Bind password {ad.passwordSet ? "(saved)" : ""}</label>
          <input
            type="password"
            value={adForm.password}
            onChange={(e) => setAdForm({ ...adForm, password: e.target.value })}
            placeholder={ad.passwordSet ? "Leave blank to keep" : ""}
            autoComplete="new-password"
          />
        </div>
        <label className="choice" style={{ alignSelf: "end", marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={adForm.useTls}
            onChange={(e) =>
              setAdForm({ ...adForm, useTls: e.target.checked, port: e.target.checked ? 636 : 389 })
            }
          />
          Use TLS (LDAPS)
        </label>
      </div>
      <div>
        <label>User filter</label>
        <input
          value={adForm.userFilter}
          onChange={(e) => setAdForm({ ...adForm, userFilter: e.target.value })}
        />
      </div>
      <div className="row-actions">
        <button className="primary" type="submit" disabled={busy}>
          Save AD settings
        </button>
        <button className="ghost" type="button" disabled={busy} onClick={onTest}>
          Test LDAP bind
        </button>
        <button className="ghost" type="button" disabled={busy} onClick={onSync}>
          Sync AD users &amp; groups
        </button>
      </div>
    </form>
  );
}
