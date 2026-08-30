"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Policy } from "@/lib/policy";
import { useConfirm } from "../_components/confirm-dialog";
import {
  argumentPatternError,
  emptyRuleDraft,
  ruleDraftToPolicyBody,
  type PreviewableRequest,
  type RuleDraft,
  type UserGroupIds,
} from "@/lib/policy-draft-preview";
import { MatchPreview } from "./match-preview";
import { RuleFormFields, type Group } from "./rule-form-fields";

/** Long patterns stay scannable in the table; the full one lives in the tooltip. */
function shortPattern(pattern: string): string {
  return pattern.length > 28 ? `${pattern.slice(0, 27)}…` : pattern;
}

export function AllowlistsClient({
  rows,
  groups,
  canManage,
  recentRequests,
  userGroupIds,
}: {
  rows: Policy[];
  groups: Group[];
  canManage: boolean;
  recentRequests: PreviewableRequest[];
  userGroupIds: UserGroupIds;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<RuleDraft>(emptyRuleDraft);
  const [error, setError] = useState("");
  const { confirm, dialog } = useConfirm();

  function patch(p: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, ...p }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (draft.bindType === "group" && !draft.bindId) {
      setError("Pick a group for this rule.");
      return;
    }
    const body = ruleDraftToPolicyBody(draft);
    // Same check the API runs — fail fast on broken advanced regexes.
    const patternError = argumentPatternError(body.argumentPattern);
    if (patternError) {
      setError(patternError);
      return;
    }
    const res = await fetch("/api/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const answer = (await res.json().catch(() => ({}))) as { error?: string };
      setError(answer.error || "Could not save policy");
      return;
    }
    setDraft(emptyRuleDraft());
    startTransition(() => router.refresh());
  }

  async function remove(id: string, name: string) {
    const confirmed = await confirm({
      title: `Remove rule “${name}”?`,
      body: "That program falls back to needing approval before it can elevate.",
      confirmLabel: "Remove rule",
      danger: true,
    });
    if (!confirmed) return;
    const res = await fetch(`/api/policies/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "Could not remove policy");
      return;
    }
    startTransition(() => router.refresh());
  }

  function bindLabel(row: Policy) {
    if (row.bindType === "group") {
      const group = groups.find((g) => g.id === row.bindId);
      return group ? `Group: ${group.name}` : `Group ${row.bindId}`;
    }
    if (row.bindType === "user") return `User ${row.bindId}`;
    if (row.bindType === "device") return `Device ${row.bindId}`;
    return "Everyone";
  }

  return (
    <>
      {canManage ? (
        <RuleFormFields draft={draft} onPatch={patch} groups={groups} error={error} onSubmit={onSubmit} />
      ) : null}
      {canManage ? <MatchPreview draft={draft} requests={recentRequests} userGroupIds={userGroupIds} /> : null}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Policy</th>
              <th>Match</th>
              <th>Scope</th>
              <th>Children</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <div>
                      <span className={`pill ${row.effect === "require_approval" ? "pending" : row.effect}`}>
                        {row.effect}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div>{row.fileName || "any name"}</div>
                    <div className="mono">{row.publisher}</div>
                    <div className="mono">{row.fileHash.slice(0, 20)}…</div>
                    {row.argumentPattern ? (
                      <div className="mono" title={row.argumentPattern}>
                        args: {shortPattern(row.argumentPattern)}
                      </div>
                    ) : null}
                  </td>
                  <td>{bindLabel(row)}</td>
                  <td>{row.childProcesses}</td>
                  <td>
                    {canManage ? <button className="danger" onClick={() => remove(row.id, row.name)}>Remove</button> : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="lede" style={{ padding: 18 }}>No program rules yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {dialog}
    </>
  );
}
