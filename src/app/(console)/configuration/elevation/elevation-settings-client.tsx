"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UacMode } from "@/lib/uac-mode";

const MODES: Array<{ id: UacMode; title: string; body: string }> = [
  {
    id: "collect",
    title: "Collect only",
    body: "Record which programs asked for elevated credentials. Standard users are not asked to send a PrivGate request after Windows UAC.",
  },
  {
    id: "prompt",
    title: "Offer a request",
    body: "After Windows UAC closes, ask the user if they want to request the program through PrivGate. Appearances are still recorded.",
  },
];

export function ElevationSettingsClient({
  initial,
  canManage,
}: {
  initial: UacMode;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<UacMode>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/elevation-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uacMode: mode }),
    });
    const body = (await res.json().catch(() => ({}))) as { uacMode?: UacMode; error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not save elevation mode.");
      return;
    }
    setMode(body.uacMode === "collect" ? "collect" : "prompt");
    setMessage("Saved. Connected PCs pick this up within a minute.");
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Elevation</h1>
          <p className="lede">
            Choose what happens on PCs after a standard user hits Windows UAC. This applies to the
            whole environment. Always-allow rules and Helper requests are unchanged.
          </p>
        </div>
      </div>
      <div className="panel stack" style={{ padding: 18 }}>
        <strong>After Windows asks for credentials</strong>
        <div className="choice-grid">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={mode === item.id ? "choice selected" : "choice"}
              aria-pressed={mode === item.id}
              disabled={!canManage || busy}
              onClick={() => setMode(item.id)}
            >
              <span className="k">{item.id === "collect" ? "Observe" : "Assist"}</span>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </button>
          ))}
        </div>
        {canManage ? (
          <div>
            <button className="primary" type="button" disabled={busy || mode === initial} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <p className="lede" style={{ fontSize: 12, margin: 0 }}>
            Your role can view this setting but cannot change it.
          </p>
        )}
        {message ? <p className="lede" style={{ margin: 0 }}>{message}</p> : null}
        {error ? <p className="err">{error}</p> : null}
      </div>
    </>
  );
}
