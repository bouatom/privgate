"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Policy } from "@/lib/policy";
import {
  allowlistBlockedReason,
  allowlistDraftFromRequest,
  allowPolicyCoversRequest,
  type AllowlistSource,
} from "@/lib/allowlist-from-request";

export function AllowlistFromRequestButton({
  source,
  policies,
  canManage,
}: {
  source: AllowlistSource;
  policies: Policy[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"device" | "all" | null>(null);
  const [error, setError] = useState("");

  const blocked = allowlistBlockedReason(source.filePath, source.fileHash, source.publisher);
  const covered = policies.some((policy) => allowPolicyCoversRequest(policy, source));

  if (!canManage) return null;
  if (covered) return <span className="lede">On allowlist</span>;
  if (blocked) {
    return (
      <span className="lede" title={blocked}>
        Cannot allowlist
      </span>
    );
  }

  async function create(scope: "device" | "all") {
    setBusy(scope);
    setError("");
    const res = await fetch("/api/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(allowlistDraftFromRequest(source, scope)),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "Could not create always-allow rule.");
      setBusy(null);
      return;
    }
    startTransition(() => router.refresh());
    setBusy(null);
  }

  return (
    <div className="row-actions">
      <button className="primary" type="button" disabled={busy !== null} onClick={() => create("device")}>
        {busy === "device" ? "Saving…" : "Allow on this PC"}
      </button>
      <button className="ghost" type="button" disabled={busy !== null} onClick={() => create("all")}>
        {busy === "all" ? "Saving…" : "Allow everywhere"}
      </button>
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}
