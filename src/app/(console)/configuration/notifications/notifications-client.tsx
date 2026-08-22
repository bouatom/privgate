"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NotificationSettings } from "@/lib/db";

export function NotificationsClient({ initial }: { initial: NotificationSettings }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<NotificationSettings>(initial);
  const [smtpPass, setSmtpPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, smtpPass: smtpPass || undefined }),
    });
    const body = (await res.json()) as NotificationSettings & { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not save notifications");
      return;
    }
    setForm(body);
    setSmtpPass("");
    setMessage("Notification settings saved. SMTP password is stored encrypted.");
    startTransition(() => router.refresh());
  }

  async function test() {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/notifications", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Test failed. Enable email or a webhook and save first.");
      return;
    }
    setMessage("Test notification sent.");
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Notifications</h1>
          <p className="lede">
            Choose how approvers hear about new elevation requests and decisions. Email uses your SMTP relay. A webhook
            can post to Slack, Teams, or any HTTPS endpoint.
          </p>
        </div>
      </div>

      <form className="panel stack" style={{ padding: 18 }} onSubmit={save}>
        <strong>When to notify</strong>
        <label className="choice">
          <input type="checkbox" checked={form.onPending} onChange={(e) => setForm({ ...form, onPending: e.target.checked })} />
          New elevation request (needs approval)
        </label>
        <label className="choice">
          <input type="checkbox" checked={form.onApproved} onChange={(e) => setForm({ ...form, onApproved: e.target.checked })} />
          Request approved
        </label>
        <label className="choice">
          <input type="checkbox" checked={form.onDenied} onChange={(e) => setForm({ ...form, onDenied: e.target.checked })} />
          Request denied
        </label>
        <label className="choice">
          <input type="checkbox" checked={form.onJit} onChange={(e) => setForm({ ...form, onJit: e.target.checked })} />
          JIT admin window opened
        </label>
        <label className="choice">
          <input type="checkbox" checked={form.criticalOnly} onChange={(e) => setForm({ ...form, criticalOnly: e.target.checked })} />
          Only high and critical risk pending requests
        </label>

        <strong style={{ marginTop: 8 }}>Email</strong>
        <label className="choice">
          <input type="checkbox" checked={form.emailEnabled} onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })} />
          Send approval emails
        </label>
        <div className="grid cards">
          <div>
            <label>SMTP host</label>
            <input value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="smtp.office365.com" />
          </div>
          <div>
            <label>Port</label>
            <input type="number" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })} />
          </div>
          <label className="choice" style={{ alignSelf: "end", marginBottom: 10 }}>
            <input type="checkbox" checked={form.smtpSecure} onChange={(e) => setForm({ ...form, smtpSecure: e.target.checked })} />
            Implicit TLS (port 465)
          </label>
        </div>
        <div className="grid cards">
          <div>
            <label>SMTP username</label>
            <input value={form.smtpUser} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} autoComplete="off" />
          </div>
          <div>
            <label>SMTP password {form.passwordSet ? "(saved)" : ""}</label>
            <input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={form.passwordSet ? "Leave blank to keep" : ""} autoComplete="new-password" />
          </div>
          <div>
            <label>From address</label>
            <input value={form.smtpFrom} onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })} placeholder="privgate@contoso.test" />
          </div>
        </div>
        <div>
          <label>Approver recipients</label>
          <input value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} placeholder="ada@contoso.test, secops@contoso.test" />
        </div>

        <strong style={{ marginTop: 8 }}>Webhook</strong>
        <label className="choice">
          <input type="checkbox" checked={form.webhookEnabled} onChange={(e) => setForm({ ...form, webhookEnabled: e.target.checked })} />
          POST JSON to a webhook URL
        </label>
        <div>
          <label>Webhook URL</label>
          <input value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} placeholder="https://hooks.slack.com/services/…" />
        </div>

        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        <div className="row-actions">
          <button className="primary" type="submit" disabled={busy}>Save</button>
          <button className="ghost" type="button" disabled={busy} onClick={() => void test()}>Send test</button>
        </div>
      </form>
    </>
  );
}
