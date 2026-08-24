"use client";

import type { FormEvent } from "react";
import type { PolicyEffect } from "@/lib/policy";
import type { RuleDraft } from "@/lib/policy-draft-preview";

export type Group = { id: string; name: string; memberCount: number };

/**
 * Fields for hand-writing a program rule. Renders inputs only — draft state
 * and submission live in AllowlistsClient, so this stays free of fetch logic.
 */
export function RuleFormFields({
  draft,
  onPatch,
  groups,
  error,
  onSubmit,
}: {
  draft: RuleDraft;
  onPatch: (patch: Partial<RuleDraft>) => void;
  groups: Group[];
  error: string;
  onSubmit: (e: FormEvent) => void;
}) {
  const rawRegex = draft.argumentMode === "regex";
  return (
    <form className="panel stack" onSubmit={onSubmit} style={{ padding: 18, marginBottom: 16 }}>
      <div className="grid cards">
        <div>
          <label>Name</label>
          <input value={draft.name} onChange={(e) => onPatch({ name: e.target.value })} required />
        </div>
        <div>
          <label>Publisher</label>
          <input
            value={draft.publisher}
            onChange={(e) => onPatch({ publisher: e.target.value })}
            required
            placeholder="CN=Contoso Code Signing"
          />
          <p className="lede">Exact string, case-insensitive — wildcards are not supported.</p>
        </div>
        <div>
          <label>SHA-256</label>
          <input value={draft.fileHash} onChange={(e) => onPatch({ fileHash: e.target.value })} required />
        </div>
      </div>
      <div className="grid cards">
        <div>
          <label>File name (optional extra check)</label>
          <input
            value={draft.fileName}
            onChange={(e) => onPatch({ fileName: e.target.value })}
            placeholder="WidgetSetup.msi"
          />
        </div>
        <div>
          <label>When a request matches</label>
          <select value={draft.effect} onChange={(e) => onPatch({ effect: e.target.value as PolicyEffect })}>
            <option value="allow">Allow silently</option>
            <option value="deny">Deny</option>
            <option value="require_approval">Require approval</option>
          </select>
        </div>
        <div>
          <label>Arguments must match (optional)</label>
          <input
            value={draft.argumentsText}
            onChange={(e) => onPatch({ argumentsText: e.target.value })}
            placeholder={rawRegex ? 'regular expression, e.g. /qn$' : "exact text match"}
          />
          <p className="lede">
            {rawRegex
              ? "Regular expression (advanced) — tested against the whole argument string."
              : "Exact text match — compared against the whole argument string."}
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={rawRegex}
              onChange={(e) => onPatch({ argumentMode: e.target.checked ? "regex" : "literal" })}
            />
            Advanced: write a raw regular expression
          </label>
        </div>
      </div>
      <div className="grid cards">
        <div>
          <label>Who can use it</label>
          <select
            value={draft.bindType}
            onChange={(e) =>
              onPatch({
                bindType: e.target.value as RuleDraft["bindType"],
                bindId: e.target.value === "all" ? "" : draft.bindId,
              })
            }
          >
            <option value="all">Everyone</option>
            <option value="group">Security group</option>
          </select>
        </div>
        {draft.bindType === "group" ? (
          <div>
            <label>Group</label>
            <select value={draft.bindId} onChange={(e) => onPatch({ bindId: e.target.value })} required>
              <option value="">Select a group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.memberCount})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {error ? <p className="err">{error}</p> : null}
      <button className="primary" type="submit">Add rule</button>
    </form>
  );
}
