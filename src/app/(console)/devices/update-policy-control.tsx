"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Per-device update policy control shown in the DeviceDrawer slide-over.
 * Displays the server-resolved effective policy (device > group > default)
 * and lets an admin override a single device (PUT /api/devices/[id]/policy)
 * or clear it so the device inherits again (mode '').
 */

const MODE_OPTIONS = [
  { value: "", label: "Inherit (use group / default)" },
  { value: "auto", label: "Auto — update automatically" },
  { value: "scheduled", label: "Scheduled — daily maintenance window" },
  { value: "manual", label: "Manual — only explicit update clicks" },
] as const;

export type PolicyControlInput = {
  deviceId: string;
  hostname: string;
  deviceMode: string;
  deviceSchedule: string;
  effMode: string;
  effSchedule: string;
  effSource: "device" | "group" | "default";
  effSourceName?: string;
};

function effectiveLine(input: PolicyControlInput): { mode: string; note: string } {
  const describe = (mode: string, schedule: string) =>
    mode === "scheduled" ? `Scheduled daily at ${schedule}` : mode === "manual" ? "Manual updates only" : "Automatic updates";
  if (input.effSource === "device") return { mode: describe(input.effMode, input.effSchedule), note: "set on this device" };
  if (input.effSource === "group") {
    return { mode: describe(input.effMode, input.effSchedule), note: `from group '${input.effSourceName || ""}'` };
  }
  return { mode: describe(input.effMode, input.effSchedule), note: "platform default" };
}

export function UpdatePolicyControl(props: PolicyControlInput) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState(props.deviceMode);
  const [schedule, setSchedule] = useState(props.deviceSchedule || "02:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Re-sync drafts when the server re-renders after a mutation.
  useEffect(() => {
    setMode(props.deviceMode);
    setSchedule(props.deviceSchedule || "02:00");
    setError("");
    setMessage("");
  }, [props.deviceMode, props.deviceSchedule, props.deviceId]);

  async function savePolicy(clear: boolean) {
    const next = clear ? "" : mode;
    if (!clear && next === "scheduled" && !schedule) {
      setError("Pick a maintenance time (HH:MM).");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(props.deviceId)}/policy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next === "scheduled" ? { mode: next, schedule } : { mode: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `policy update failed (${res.status})`);
        return;
      }
      setMessage(clear ? "Policy cleared — device inherits again." : "Policy updated.");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const effective = effectiveLine(props);

  return (
    <section className="panel" style={{ padding: 14, marginBottom: 16 }}>
      <div className="policy-value">
        <span className="k" style={{ textTransform: "uppercase" }}>
          Update policy
        </span>
        <span className="pill active" title="Effective policy">
          {props.effSource === "default" ? "default" : props.effMode}
        </span>
        {props.effMode === "scheduled" ? <span className="mono">{props.effSchedule}</span> : null}
      </div>
      <p className="lede" style={{ fontSize: 13, marginTop: 6, marginBottom: 10 }}>
        <strong>{effective.mode}</strong>
        {" · "}
        {effective.note}
      </p>
      <div className="policy-editor">
        <label htmlFor={`policy-mode-${props.deviceId}`}>
          Override for this device
        </label>
        <div className="policy-editor-row">
          <select
            id={`policy-mode-${props.deviceId}`}
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value)}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {mode === "scheduled" ? (
            <input
              type="time"
              aria-label="Maintenance window time"
              value={schedule}
              disabled={busy}
              onChange={(e) => setSchedule(e.target.value)}
            />
          ) : null}
          <button
            type="button"
            className="ghost icon-btn"
            disabled={busy || mode === props.deviceMode}
            onClick={() => void savePolicy(false)}
          >
            {busy ? "Saving…" : "Set"}
          </button>
          {props.deviceMode ? (
            <button
              type="button"
              className="ghost icon-btn"
              disabled={busy}
              onClick={() => void savePolicy(true)}
            >
              Inherit / clear
            </button>
          ) : null}
        </div>
        {error ? <p className="err">{error}</p> : null}
        {message ? <p className="ok">{message}</p> : null}
      </div>
    </section>
  );
}