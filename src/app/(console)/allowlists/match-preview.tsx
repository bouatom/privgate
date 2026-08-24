"use client";

import { useMemo } from "react";
import { displayPath, formatWhenShort } from "@/lib/format";
import {
  describeVerdict,
  previewRuleAgainstRequests,
  ruleDraftToPolicyBody,
  type PreviewableRequest,
  type RuleDraft,
  type UserGroupIds,
  type VerdictKind,
} from "@/lib/policy-draft-preview";

const PILL_BY_KIND: Record<VerdictKind, string> = {
  allow: "pill allow",
  deny: "pill deny",
  require_approval: "pill pending",
  "hard-banned": "pill denied",
  miss: "pill canceled",
};

/** Collapsible dry-run of the current draft against recent elevation requests. */
export function MatchPreview({
  draft,
  requests,
  userGroupIds,
}: {
  draft: RuleDraft;
  requests: PreviewableRequest[];
  userGroupIds: UserGroupIds;
}) {
  const body = useMemo(() => ruleDraftToPolicyBody(draft), [draft]);
  const verdicts = useMemo(
    () => previewRuleAgainstRequests(body, requests, userGroupIds),
    [body, requests, userGroupIds],
  );
  const matched = verdicts.filter((v) => v.matches).length;

  return (
    <details className="panel" style={{ padding: 18, marginBottom: 16 }}>
      <summary>
        Test against recent requests — {matched} of {verdicts.length} would match
      </summary>
      <p className="lede" style={{ padding: 12 }}>
        Dry run only. Compares the form above against the latest recorded elevation requests using the same
        matching rules as the engine (hash, publisher, file name, arguments, and who/where the rule is bound to).
        It does not decide waiting requests.
      </p>
      {requests.length ? (
        <table>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Program</th>
              <th>User / PC</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {verdicts.map((verdict) => {
              const { kind, label } = describeVerdict(body, verdict);
              return (
                <tr key={verdict.request.id}>
                  <td className="lede">{formatWhenShort(verdict.request.requestedAt)}</td>
                  <td className="mono">{displayPath(verdict.request.filePath)}</td>
                  <td>
                    {verdict.request.userName}
                    <div className="lede">{verdict.request.hostname}</div>
                  </td>
                  <td>
                    <span className={PILL_BY_KIND[kind]}>{label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="lede" style={{ padding: 12 }}>No recent requests recorded yet.</p>
      )}
    </details>
  );
}
