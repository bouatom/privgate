# Audit-First Elevation Workflow — Research & Phased Plan

Research only; no code changed. Baseline HEAD `94cacc2`. Goal: observe **all** stock-UAC
elevation activity on managed PCs (managed = mediated by PrivGate; unmanaged = direct
Run-as-administrator), classify outcomes, report them, and create rules from report rows.

---

## 0. Verification: the double-record / false-telemetry bug is REAL

**Verdict: confirmed, and it is both a bug and the exact hook we need.**

- `agent/ConsentWatch.cs:16-26` — `ShouldPrompt` returns true on **any** transition of
  session consent PIDs from non-empty → empty. The doc comment (`ConsentWatch.cs:13-15`)
  explicitly admits the ambiguity: *"UAC closed: cancel, timeout, or an administrator
  approved the Windows prompt."*
- `agent/ElevationPrompt.cs:36-70` — `RunTick()` captures `_pendingTarget` when consent
  appears (`ElevationPrompt.cs:53`), then on close unconditionally calls
  **`ElevationClient.ReportCanceled(_pendingTarget)`** (`ElevationPrompt.cs:62`) and
  **`AskAfterUac(_pendingTarget)`** (`ElevationPrompt.cs:63`). There is no success check.
- Downstream chain that records the false "canceled" row:
  `ElevationClient.cs:16-35` (pipe payload `mode=uac-canceled`, fire-and-forget) →
  `BrokerHost.cs:159-166` (dispatch) → `ApiClient.cs:53-61` →
  `RealtimeChannel.cs:102-113` (`type:"uac-canceled"` over the HMAC socket) →
  `src/lib/realtime/rpc.ts:93-121` (inserts `requests` row `status='canceled'`,
  dedupe at `rpc.ts:102-106`, audit `device.uac.canceled` at `rpc.ts:118`).
- User-visible nag: `AskAfterUac` shows *"Windows asked for administrator approval and the
  prompt was closed…"* (`ElevationPrompt.cs:76-101`) — shown even to an administrator who
  just approved their own prompt.

**Consequence:** every successful self-approval by an existing admin pollutes the requests
queue with a fake cancellation AND nags the user. Conversely, this same consent-close event
is the single reliable observation point for *all* stock-UAC activity — so fixing it means
building outcome classification, which is exactly what audit-first needs.

Tick plumbing: tray timer fires `Refresh()` every 1.5 s (`AgentTray.cs:36-38`),
`RefreshBody` calls `ElevationPrompt.TickConsent()` (`AgentTray.cs:135`) after already
holding a broker `StatusSnapshot` (`AgentTray.cs:121-133`) — useful for suppression (§3).

---

## 1. Outcome classification on the agent (no hooks, no bypasses)

AGENTS.md forbids UAC bypasses/stored creds; everything below is passive userland read-only.

### Options analyzed

**(a) Elevated-child detection — RECOMMENDED PRIMARY.**
When consent PIDs go empty, for up to N≈10 s poll (reuse the 1.5 s tick) for newly-started
processes whose image name matches the captured foreground target (or whose parent PID maps
to it via `CreateToolhelp32Snapshot`, whose `PROCESSENTRY32.th32ParentProcessID` gives us
parentage without NtQuery). Then classify:

- `QueryFullProcessImageName` under `PROCESS_QUERY_LIMITED_INFORMATION` (0x1000) works
  cross-integrity — proven in-repo by `ForegroundTracker.cs:115-130`, which already reads
  arbitrary (including elevated) process paths from the medium-IL tray.
- Token checks: `OpenProcessToken` accepts a limited-information handle since Vista, but a
  medium-IL caller frequently gets `ERROR_ACCESS_DENIED` opening a token on a high-IL
  process. **Mitigation: run the classifier in the broker service (SYSTEM)**, not the tray:
  the tray already talks to it over the named pipe (`ElevationClient.PostOneWay`,
  `ElevationClient.cs:63-72`; `BrokerHost.Handle`, `BrokerHost.cs:149+`). SYSTEM can open
  any token. Checks that survive: `GetTokenInformation(TokenElevationType)` →
  `TokenElevationTypeFull` = elevated; `GetTokenInformation(TokenUser)` compared against the
  interactive user's SID distinguishes self vs other creds.

**(b) Windows Event Log** (`Microsoft-Windows-UAC/Operational`, Security 4688): requires
event-log channel/audit policy we cannot assume on customer machines. Optional future
enrichment only; do not gate on it.

**(c) Heuristic-only fallback** (consent closed + no elevated child seen + target never
opened): keep as fallback when (a)'s window finds nothing or pipe/classifier fails.

### Recommended pipeline

1. Tray detects consent-close (existing `ConsentWatch`).
2. Tray asks broker over pipe: new `mode=uac-classify {userSid, filePath}`; service watches
   process creation for ~8–10 s, returns outcome + optional hash/publisher
   (`Authenticode.Sha256File/Publisher` already exist — used in `BrokerHost.cs:208-209`).
3. Enum (honest about what userland can know):

| Outcome | Meaning | How known |
|---|---|---|
| `approved-self` | elevated child running under the interactive user's token | elevation type Full + token user == interactive SID |
| `approved-other-creds` | elevated child under a different account | token user != interactive SID |
| `escaped` | user canceled / dismissed, nothing elevated | no qualifying elevated child |
| `timeout` | consent stayed ≥~110 s then closed with nothing elevated | visibility duration heuristic |
| `unknown` | classifier failed / ambiguous PID reuse / race | default fallback |

`canceled` (legacy rows) ≈ today's `escaped`. `elevatedByOther` boolean is derived from
outcome, kept in the payload for cheap filtering.

### Sizing & risk

- New file `agent/UacOutcomeClassifier.cs` (~150 lines; keeps `ElevationPrompt.cs` at 213
  lines well under the 300 soft cap per AGENTS.md module-size rule).
- Risk: **PID reuse and installer chains** (child spawns grandchildren; consent may exit
  before the elevated process appears) → mitigate with short polling window + image-name
  match + `unknown` fallback. Residual misclassification is reported honestly as `unknown`.

---

## 2. Telemetry contract

### WS RPC

Extend `AgentRpc` union (`rpc.ts:10-24`) with:

```
{ type: "uac-observed"; userSid: string; filePath?: string; fileHash?: string;
  publisher?: string; outcome: string; elevatedByOther?: boolean }
```

Transport security is unchanged: devices authenticate once at upgrade with
`verifyDeviceRequest` HMAC headers (`agent-hub.ts:82-94`; client side
`RealtimeChannel.ConnectAsync`, `RealtimeChannel.cs:134-149`); messages ride the same
socket as today's `uac-canceled`. Validation mirrors existing strictness: whitelist
`outcome` against the enum, cap/sanitize strings exactly like the `uac-canceled` handler
(`rpc.ts:99-101`), reject unknown outcomes with `{ ok:false }` like `client-status`
(`rpc.ts:36-51`). Add `ObservedUacAsync` next to `UacCanceledAsync`
(`RealtimeChannel.cs:102-113`) and a `mode=uac-observed` branch in `BrokerHost.Handle`
(next to `BrokerHost.cs:159-166`).

### Storage decision: NEW `elevations` table (recommended)

Why not `requests.status='unmanaged'|'observed'`:

- `requests.user_id` is `NOT NULL` (`schema.ts:51`) and `listRequests` uses INNER JOINs on
  `users`/`devices` (`src/lib/db/requests.ts:5-20`) — an actor the directory doesn't know
  (exactly the unmanaged-admin case, e.g. a local account approving with other creds)
  either breaks inserts or silently vanishes from lists. The current handler hard-rejects
  unknown users outright (`rpc.ts:95-98`); audit-first must record them.
- Every consumer of `requests` would need status-exclusion changes: dashboard counts
  (`metrics.ts:47-71` — note `topPrograms` iterates ALL statuses, `metrics.ts:64-67`, so
  observed rows would distort it), device blocked filter (`device-detail.tsx:74-81`),
  pending dedupe (`requests.ts:60-67`).
- Dedupe semantics differ: observations are append-mostly events (dedupe window per
  device+path+outcome, e.g. collapse within 2 min), not a pending state machine.

```sql
CREATE TABLE IF NOT EXISTS elevations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_sid TEXT NOT NULL DEFAULT '',
  user_id TEXT,                          -- nullable: unknown/local actors stay NULL
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,                 -- enum from §1
  managed INTEGER NOT NULL DEFAULT 0,    -- 1 when PrivGate mediated this elevation
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_elevations_at ON elevations(observed_at);
CREATE INDEX IF NOT EXISTS idx_elevations_device_at ON elevations(device_id, observed_at);
```

New module `src/lib/db/elevations.ts` (insert/list/count) following `db/audit.ts` patterns;
keep `appendAudit(db, "device:<id>", "device.uac.observed", deviceId, {...})`
(`db/audit.ts:5-15`) for the audit trail. Managed flag: server marks `managed=1` when an
evaluate→allow ticket or pending→approved push exists for the same device+hash within ±90 s
of `observed_at`.

Sizing ~120 lines new TS + ~15 in rpc.ts. Risk low; biggest care point is keeping
`listRequests` untouched.

---

## 3. Suppression rules (don't double-record or nag on PrivGate-mediated flows)

PrivGate-mediated launches normally never show consent.exe (the broker launches the
elevated child itself, `BrokerHost.cs:252,267`), but two overlaps need explicit handling:

1. **Self-approval success** (§1 primary fix): classifier says `approved-*` → suppress
   BOTH `ReportCanceled` (`ElevationPrompt.cs:62`) and the follow-up dialog
   (`ElevationPrompt.cs:63`). Only `escaped|timeout|unknown` continue down today's path.
2. **Mediation-in-flight window**: a pending request may be approved while the user also
   pokes stock UAC; JIT users re-running apps trigger real consent too. The broker already
   knows its own recent tickets: `BrokerStatus.NoteRequest(path, decision)`
   (`BrokerStatus.cs:93-102`, 12-entry ring) and `NotePending`
   (`BrokerStatus.cs:114-117`). Add `NoteMediated(filePath, until)` called from
   `BrokerHost.Handle` on `decision=="allow"` (`BrokerHost.cs:226-268`), exposed on
   `StatusSnapshot` (`BrokerStatus.cs:129-153`). The tray already holds the snapshot each
   tick (`AgentTray.cs:121-135`) — pass it into `TickConsent(snap)` instead of re-querying;
   suppress the nag if the captured path was mediated within ~90 s. No new IPC needed
   beyond the snapshot field; detached-tray mode still works via `TryQueryPipe`
   (`BrokerStatus.cs:157-174`).

Risk: suppressing too much hides genuine escapes during a JIT window → keep recording the
observation (audit-first!), only suppress the *dialog* and the `canceled`-style report;
the `uac-observed` row still lands with its classified outcome.

---

## 4. Reporting surface

New `(console)/elevations` page modeled on the dashboard card/table structure
(`dashboard/page.tsx:34-66` cards, `:111-131` top-programs table, `:134-164` recent table):

- Cards: unmanaged elevations (7d), escaped/canceled (7d), approved-self vs
  approved-other split, top program.
- Tables: top programs (`GROUP BY file_path ORDER BY COUNT(*) DESC LIMIT 10`), per-device
  filter (`WHERE device_id = ?` using `idx_elevations_device_at`), time-bucketed counts
  (`GROUP BY substr(observed_at, 1, 10)` for daily series).
- Actor resolution: LEFT JOIN `users` (nullable!) then reuse `presentAudit`'s resolver
  pattern — unmapped actors render verbatim rather than being dropped
  (`src/lib/present.ts:35-45`), which is exactly right for local accounts.
- Per-device drill-in: extend the device page alongside the existing blocked panel
  ("Could not elevate", `device-detail.tsx:97-181`) with an "All UAC activity" section fed
  from elevations; `listAuditForDevice`'s device-scoped query shape is the template
  (`db/audit.ts:91-102`). `idx_audit_events_at` exists for the audit tab
  (`schema.ts:83`); the two new indexes cover the elevations queries.
- SQL sketch for the headline query:
  ```sql
  SELECT e.outcome, COUNT(*) AS n FROM elevations e
  WHERE e.observed_at >= :from AND (:deviceId IS NULL OR e.device_id = :deviceId)
  GROUP BY e.outcome;
  ```

Sizing ~180 lines page + ~60 lib. Risk low; nav/permission gating reuses `can()`
(`dashboard/page.tsx:9-10` pattern).

---

## 5. Rule-from-row

The mechanism already works end-to-end for canceled rows: `AllowlistFromRequestButton`
renders in the device blocked panel (`device-detail.tsx:152-168`) and posts a policy built
by `allowlistDraftFromRequest` (`allowlist-from-request-button.tsx:47-77`;
`allowlist-from-request.ts:31-48`). Extending to elevations rows:

- Build the same `AllowlistSource` from an elevations row (`filePath/fileHash/publisher/
  arguments/deviceId`) — the draft needs nothing else (`allowlist-from-request.ts:4-11`).
- Gating stays honest: `allowlistBlockedReason` requires hash AND publisher
  (`allowlist-from-request.ts:13-21`) → button renders "Cannot allowlist" when we only
  sampled a foreground path with no hash. Mitigation: agent computes SHA256 +
  Authenticode publisher at observation time when `File.Exists(path)` (§1 step 2), making
  most rows rule-ready; genuinely unidentified rows (`(unidentified program)` placeholder,
  cf. `rpc.ts:99`) stay gated.
- Caveat to document in UI copy: foreground sampling is best-effort
  (`ForegroundTracker.cs:9-15`), so a rule created from an observation anchors on
  hash+publisher, not the sampled filename — same trust model as today's blocked rows.
- Skip the approve-follow-up branch (`requestPending` stays false for observations,
  `allowlist-from-request-button.tsx:63-74`).

Sizing ~40 lines (button accepts an optional pre-built source; elevations table cell).
Risk: low — worst case is a gated button.

---

## 6. Phases (each independently shippable)

### P1 — Stop lying: fix double-record/nag + outcome enum plumbing
- Agent: add `UacOutcomeClassifier.cs`; `RunTick` classifies before reporting
  (`ElevationPrompt.cs:59-69` becomes outcome-aware); suppression per §3; pipe gains
  `mode=uac-classify` + `mode=uac-observed`.
- Server: accept `uac-observed` (validation per §2) writing ONLY audit events initially
  (`appendAudit`, action `device.uac.observed`) — telemetry visible in the audit log
  before storage lands.
- Tests: vitest for rpc validation/dedupe seams extending `uac-canceled.test.ts`
  patterns (`uac-canceled.test.ts:33-114`: seed user via `upsertUsers`, fake socket via
  `registerDeviceSocket`, direct `handleAgentRpc` calls); C# compile gate
  `scripts/smoke-agent-build.sh` (publishes net48 broker + helper, checks binding
  redirects, `smoke-agent-build.sh:14-28`).
- Real-Windows checklist (manual): admin self-approval produces NO nag and NO canceled row;
  cancel produces one escaped observation; other-creds approval classified correctly;
  JIT-window self-elevation recorded once.

### P2 — Storage + report page
- Migration: `elevations` table + indexes via `migrate()` (`schema.ts:6-151`,
  plain `CREATE TABLE IF NOT EXISTS`; nullable columns need no `ensureColumn`
  (`schema.ts:153-157`) since it's a new table).
- `src/lib/db/elevations.ts`; `uac-observed` handler persists + audits; managed-flag
  reconciliation job (server-side, ±90 s window over requests).
- `(console)/elevations` page + device-page section (§4). Tests: vitest over
  insert/list/count and the managed-flag matcher with in-memory DB; typecheck+lint
  (`npm test && npm run typecheck && npm run lint`).

### P3 — Rule-from-row polish + dashboard cards
- Allowlist button on elevation rows (§5); dashboard gains an "Unmanaged elevations (7d)"
  card linking to `/elevations` (`dashboard/page.tsx:34-66` pattern; note `topPrograms`
  must keep counting requests only unless deliberately changed, `metrics.ts:64-71`).
- Tests: component-level vitest where the repo has seams; manual matrix again on Windows.

---

## Top risks summary

1. **Misclassification** (PID reuse, installer chains, missed child) — mitigated by the
   honest `unknown` bucket and SYSTEM-side token checks; never guessed.
2. **Foreground attribution names the wrong program** — inherent to sampling
   (`ForegroundTracker.cs:41-55`); rules anchor on hash+publisher, UI copy says so.
3. **Suppression too aggressive** hiding genuine escapes during JIT windows — record the
   observation always, suppress only dialog/report duplication.
4. **Schema creep into `requests`** — avoided by the separate `elevations` table; all
   existing consumers untouched.
