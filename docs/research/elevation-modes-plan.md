# Elevation Modes Plan — Parity with Intune EPM's Four Modes

Research + planning only. Baseline HEAD `94cacc2`; line numbers reflect the working tree at
that baseline (jit/users-area files carry unrelated local edits and were read as-is).
Hard constraints from `AGENTS.md`: no UAC bypasses, no stored admin passwords, no `runas /savecred`.
Target: bring PrivGate to parity with Intune EPM's four elevation modes —

| EPM mode | PrivGate today | Verdict |
|---|---|---|
| Automatic (silent) | effect=`allow` policies | Exists; small gaps |
| User-confirmed with business justification | effect=`require_approval`, but **no justification capture** | Build (Phase 2) |
| Deny | effect=`deny` policies | Works; UX polish only |
| Virtual-account elevation | none | Feasibility study below |

---

## 0. Ground truth: how an allowed ticket actually elevates today

The full pipeline (verified end-to-end):

1. **Entry points** — tray menu (`agent/AgentTray.cs:53-55`), post-UAC-canceled offer
   (`agent/ElevationPrompt.cs:53-70`), or the helper CLI (`agent/helper/Program.cs:7-48`).
   Each posts one JSON line to the broker pipe:
   `{mode:"elevate", userSid, filePath, arguments, sessionId}`
   (`agent/ElevationClient.cs:84-98`, `agent/helper/Program.cs:33-40`). `.msc` targets are
   rewritten to `mmc.exe <path>` client-side (`agent/ElevationClient.cs:78-82`).
2. **Pipe host** derives the caller's interactive session from the client PID
   (`GetNamedPipeClientProcessId` → `ProcessIdToSessionId`, `agent/NamedPipeHost.cs:80-91`);
   ACL is SYSTEM/Admins full-control, Authenticated Users read-write
   (`agent/NamedPipeHost.cs:16-32`).
3. **Broker** hashes the file (SHA-256) and reads the Authenticode subject
   (`agent/BrokerHost.cs:208-209`), then calls console `evaluate` over the realtime socket with
   `{userSid, entraOid, filePath, fileHash, publisher, arguments}`
   (`src/lib/realtime/rpc.ts:53-59`, `src/lib/evaluate.ts:22-29`).
4. **Policy engine** (`src/lib/policy.ts:92-132`): hash+publisher required (:98-100); JIT-active
   short-circuit → allow (:101-103); hard-banned names deny unless a `require_approval`
   `highRiskException` matches (:104-112, bans list `agent/HardBans.cs:5-8`); **deny beats allow**
   (:114-118); first `allow` wins (:119-127); else pending (:128-131).
5. **Allow → ticket mint** (`src/lib/evaluate.ts:96-123`): signed ticket
   `typ=elevate|jit`, `child=allow|deny`, `exp = now+15min` (elevate) or `+120s`… per grant (JIT),
   keyed per device (`ticketKeyForDevice`, `src/lib/evaluate.ts:35-37`).
6. **Ticket verify** on-device: device match, hash match, path match (JIT exempt from both)
   (`agent/BrokerHost.cs:229-241`).
7. **Launch** — `ElevationHost.Launch(filePath, args, child=="deny", sessionId)`
   (`agent/BrokerHost.cs:267`):
   - `SessionLaunch.InSession` duplicates the **broker's own LOCAL SYSTEM service token**
     (`OpenProcessToken(Process.GetCurrentProcess())`), `DuplicateTokenEx`→primary,
     `SetTokenInformation(TokenSessionId)` = user session, `CreateEnvironmentBlock(dup, inherit:false)`
     — i.e. an environment built for the **SYSTEM profile**, not the user's — then
     `CreateProcessAsUser` onto `winsta0\default` (`agent/SessionLaunch.cs:28-85`).
   - **Net effect: the "elevated" process runs as SYSTEM inside the user's desktop session.**
     The header says it plainly: "it does not mint an admin token for the user"
     (`agent/SessionLaunch.cs:10-11`).
   - `childProcesses:"deny"` (the default, `src/lib/db/schema.ts:38`) puts the process in a Job
     object with `ActiveProcessLimit=1 | KILL_ON_JOB_CLOSE` so it cannot spawn children
     (`agent/ElevationHost.cs:74-98`).
8. **JIT is a different animal**: ticket `typ=jit` adds the user's SID to local Administrators via
   `net localgroup` (`agent/JitWatchdog.cs:77,90-116`), arms a SYSTEM schtask for auto-revoke at
   expiry (`agent/JitWatchdog.cs:20-35`), plus a 5-second watchdog tick that revokes and reports
   (`agent/BrokerHost.cs:109-128`, `agent/JitWatchdog.cs:64-73`). JIT = real local-admin membership,
   15–60 min windows.

> Key architectural fact for everything below: **ticket elevations are SYSTEM-in-session child
> processes of the broker**, not user-token admin processes and not virtual-account logons.
> Any "virtual account" work changes step 7 only; steps 1–6 are untouched by all four modes.

---

## 1. AUTOMATIC — already shipped, with three residual gaps

**Proof**: an ALLOW policy is silent automatic elevation today. Match → instant `decision=allow`
(`src/lib/policy.ts:119-127`) → ticket in the same RPC response (`src/lib/evaluate.ts:115-122`)
→ verified launch with zero prompts on the desktop (`agent/BrokerHost.cs:226-268`). No UAC is
ever shown because nothing runs through consent.exe; the tray shows only a status line
(`BrokerStatus.Current.NotePending("")`, `agent/BrokerHost.cs:266`). This satisfies EPM
"Automatic" for hash+publisher rules.

Gaps vs EPM automatic rules, ranked:

1. **`.msi` likely fails at launch (S, medium risk, fix recommended).** The pickers offer
   `*.msi` (`agent/ElevationPrompt.cs:141`, `agent/AgentTray.cs:74`) but step 7 uses
   `CreateProcessAsUser`, which cannot execute an `.msi` package directly (no shell
   resolution; expected `ERROR_BAD_EXE_FORMAT`). `.msc` already has the wrap pattern
   (`ElevationClient.cs:78-82`); mirror it: rewrite `.msi` →
   `msiexec.exe /i "<path>"` before hashing/evaluating, keeping policy matching on the original
   path/hash. Must be verified on a real Windows VM (`scripts/smoke-windows-client.ps1`).
2. **No version-range matching (M, low risk, defer).** `Policy` has no file-version field
   (`src/lib/policy.ts:5-17`) and the agent computes only hash+publisher
   (`agent/ElevationHost.cs:10-34`). EPM supports version floors ("allow ≥ x.y"). Closing this
   needs: agent reports `FileVersionInfo`, schema column, engine range check. Worth doing only if
   field data shows hash-pinning churn; keep as backlog.
3. **Child-process story differs (documented, no change).** EPM auto rules don't gate children;
   we do, by default, via the job object (`agent/ElevationHost.cs:74-98`,
   `src/lib/policy.ts:15`). This is *stricter* than EPM and defensible; document rather than
   change. Note honestly: `ActiveProcessLimit=1` also blocks legitimate single-process helpers
   spawning one child — if that bites, consider `BREAKAWAY_OK` design later, not now.

Effort S for gap 1; risks: msiexec argument injection via crafted filenames — quote exactly as
`.msc` does and reuse the same code path.

---

## 2. USER-CONFIRMED WITH BUSINESS JUSTIFICATION

**Honest framing up front**: justification is captured text for reporting/audit. It is typed by
an unauthenticated-at-the-desktop user over an authenticated pipe; anyone can type anything. It
is **not an auth factor** and must never be described as one. Its value is compliance evidence
("user said why") attached to a cryptographically bound decision trail.

### Recommendation: capture at REQUEST time, in the tray flow

Requests usually start from a double-click → UAC canceled → our offer
(`agent/ElevationPrompt.cs:53-70`) or the tray menu. The end user is present *there*; approvers
are not always. So:

- Primary: end-user types justification in the themed prompt before the pipe round-trip.
- Secondary (later, optional): approver note at approve/deny time in the console
  (`src/app/api/requests/[id]/approve/route.ts:8-25` has no body parsing today — additive).

### Design, end-to-end (all additive)

| Layer | Change | Cite | Size | Risk |
|---|---|---|---|---|
| Schema | `ensureColumn(db,"requests","justification","TEXT")`; `ensureColumn(db,"policies","require_justification","INTEGER NOT NULL DEFAULT 0")` — follows the exact additive pattern used for `risk_level`/`risk_reasons` | `src/lib/db/schema.ts:142-143,153-157` | S | Low: additive, nullable, old rows render empty |
| Types | `justification?: string \| null` on `ElevationRequest`; `requireJustification?: boolean` on `Policy` | `src/lib/db/types.ts:12-27`, `src/lib/policy.ts:5-17` | S | Low |
| Engine | `Decision` gains optional `justifyRequired` when a matched `require_approval` policy sets the flag (`src/lib/policy.ts:128-131`); evaluate response surfaces it (`src/lib/evaluate.ts:160-185`) | — | S | Low; pure addition, existing tests untouched |
| RPC body | optional `justification` on `EvaluateBody` (`src/lib/realtime/rpc.ts:10-29` → `src/lib/evaluate.ts:22-29`); server-side trim + cap (≤512 chars) + control-char strip before insert (`insertRequest` extension, `src/lib/db/requests.ts:47-91`) | — | S | Medium-low: validate like `uac-canceled` does (`rpc.ts:99-101`) |
| Agent pipe | `mode:"elevate"` payload gains `justification` field; helper CLI gains `--justification "<text>"` (`agent/ElevationClient.cs:84-91`, `agent/helper/Program.cs:33-40`) | — | S | Low |
| Agent UI | In `ElevationPrompt.Request` (`agent/ElevationPrompt.cs:147-194`): if the evaluate reply says `justifyRequired` (or optimistically when policy requires), show a second themed dialog — `Ui.Dialog` + a `TextBox` (multiline, MaxLength 512) + `Ui.Primary("Submit request")`; empty input loops once with a hint, cancel = no request filed. Reuse `Ui.Body/Note/Ghost` styling (`agent/Ui.cs:23-80`) | — | M | Medium: WinForms thread affinity — must run on the UI thread like the existing dialogs; guard with the `_busy` flag |
| Console | `RequestRow.justification` rendered under Program column in queue (`src/app/(console)/requests/requests-client.tsx:201-206` area); device drawer detail; audit details JSON already free-form (`src/lib/db/schema.ts:75-82`) so `appendAudit` details need no migration | `src/app/(console)/requests/requests-client.tsx:10-25` | M | Low |
| Form | checkbox "Ask the user why they need this" shown only when effect=`require_approval` in `RuleFormFields` (`src/app/(console)/allowlists/rule-form-fields.tsx:59-65`), wired through `ruleDraftToPolicyBody` (`src/lib/policy-draft-preview.ts`) and `/api/policies` validation (`assertAllowPolicyInput` analog, `src/lib/policy.ts:134-151`) | — | S | Low |

Length cap: enforce 512 chars server-side regardless of client; reject (not truncate) silently-
empty when flag set? **No silent rejection possible** — the pipe round-trip is fire-and-forget
from the user's perspective; enforcement lives in the tray dialog (min 3 non-space chars before
Submit enables), server stores whatever arrives, flagged `justifyRequired` requests filed without
text still appear in queue marked "(no justification provided)" so approvers can weigh that.

What NOT to do: don't block the evaluate RPC waiting on the prompt (broker pipe would hold a
thread for minutes); don't put justification in the ticket claims (it's not authorization
material); don't require it for `allow` policies (contradicts Automatic mode semantics).

---

## 3. DENY — verify and polish

Verified end-to-end: deny match wins over allow (`src/lib/policy.ts:114-118`); hard-banned
binaries deny even with no policy unless high-risk exception (`src/lib/policy.ts:104-112`); the
server inserts a request row `status="denied", decidedBy="policy"` when hash+publisher exist and
audits `evaluate.deny` with requestId (`src/lib/evaluate.ts:125-158`); broker returns raw JSON and
shows a notice (`agent/BrokerHost.cs:277-282`); tray summary prints "Denied. \<reason\>"
(`agent/ElevationPrompt.cs:204`); denied rows show under the "pending and blocked" filter
(`src/app/(console)/requests/requests-client.tsx:81-86`).

Polish gaps (all S):

1. **Message quality**: user sees generic "The request was denied." (`agent/BrokerHost.cs:280`)
   while the richer reason exists in the same reply. Show the server `reason` (and map
   `matched deny policy` → policy name via a `policyName` field added to the deny branch of
   `evaluateForDevice` — one query, `src/lib/evaluate.ts:125-158`).
2. **Deny without hash+publisher leaves no request row** (`src/lib/evaluate.ts:127`) — audit-only.
   Acceptable; document it.
3. **No notification on auto-deny** (`on_denied` exists in settings,
   `src/lib/db/schema.ts:119` but wired only for decided-by-admin paths). Optional follow-up.

Risk: trivial. Effort: S total.

---

## 4. VIRTUAL-ACCOUNT ELEVATION — feasibility study

Goal: EPM-style isolation where the elevated process runs under a throwaway identity instead of
the user (or, in our case, instead of SYSTEM-in-session).

### (a) True EPM-style throwaway virtual accounts — NOT RECOMMENDED on net48/userland

Per-elevation: `NetUserAdd` random-named local user → `LogonUser` → `LoadUserProfile` →
`CreateProcessAsUser`. Blockers found against our topology:

- **Desktop access**: a fresh account's token has no rights to `winsta0\default` in the user's
  session. Our launch path works precisely because it reuses the broker's own token
  (`agent/SessionLaunch.cs:31-44`); an arbitrary account token needs winsta/desktop DACL edits or
  service-SID grants — fragile, version-sensitive, untestable off-Windows.
- **Profile fallout**: every new account = new HKCU hive load/unload timing races
  (`LoadUserProfile` is async), profile disk churn, orphaned hives on crash. EPM solves this with
  OS-managed plumbing we cannot replicate in net48 userland.
- **Churn**: NetUserAdd/Delete per elevation spams 4720/4726 event logs, consumes RIDs, breaks if
  the box sits offline mid-lifecycle (account left behind = permanent local account, which is
  *worse* than what we have).
- **Topology fit**: our broker is a single SYSTEM service + tray + helper
  (`agent/Program.cs:13-43`); there is no per-session broker to own per-user account lifecycles.

### (b) Pragmatic alternative — dedicated `PrivGateElev` account — DEFER behind a flag

One persistent local account, created at install: random password kept only in broker memory
(NOT stored — respects AGENTS.md), denied interactive/remote logon rights
(`SeDenyInteractiveLogonRight`, `SeDenyNetworkLogonRight`), granted batch logon; added to local
Administrators (otherwise "elevation" grants nothing); used only for TICKET elevations via
`LogonUser(LOGON32_LOGON_BATCH)` → `CreateProcessAsUser`, never for JIT.

- Wins: identity separation from SYSTEM; elevated apps write HKCU into `PrivGateElev`'s hive =
  real profile isolation; blast radius below SYSTEM (no machine credentials in the token).
- Costs/risks: password custody becomes a secret to protect in-memory only; the desktop-DACL
  problem from (a) applies *unchanged* (batch-logon token still may lack `winsta0\default`
  access); app compat (installers expecting the user's profile break differently than under
  SYSTEM env, which is today's quirk via `CreateEnvironmentBlock(dup,false)`,
  `agent/SessionLaunch.cs:61`); persistent local-admin account on every fleet PC is new attack
  surface (kerberoast-style/PTH value).

### (c) Status quo — SYSTEM-in-session ticket child

Described in §0 step 7. Properties: strongest token (SYSTEM — *above* admin, stronger than EPM
intends), zero credential material, zero new accounts, proven launcher, job-object child control.
Downside: over-privileged vs least-privilege story; allowed-but-malicious binary gets SYSTEM.

### Security-property comparison

| Property | (c) today | (b) dedicated acct | (a) per-launch acct |
|---|---|---|---|
| Token privilege | SYSTEM (>admin) | Admin (member of Administrators) | Admin |
| Machine/domain creds exposed | Yes (SYSTEM) | No | No |
| New persistent attack surface | None | One local admin acct/PC | None if cleanup holds |
| Profile isolation from user | Partial (SYSTEM env block) | Real (own hive) | Real (throwaway hive) |
| Desktop/session compat | Proven | Untested (DACL risk) | Untested + churn |
| Child-process control | Job object today | Needs same job attach | Same |
| Credential storage | None | Random pw in memory only | Per-launch pw in memory |
| Fits net48/userland + topology | Fully | Mostly | Poorly |

### Recommended phased stance

Phase 4a (now): keep (c); write this document; add a `docs/` note that ticket elevations run as
SYSTEM-in-session so nobody assumes otherwise. Phase 4b (only with lab access): prototype (b)
behind `PRIVGATE_LAUNCH_IDENTITY=system|privgateelev` config, gated to test devices, measuring
desktop-token failures and app-compat deltas. **Explicitly unpromised until tested on real
Windows**: winsta DACL behavior for batch tokens, LoadUserProfile timing under
`CreateProcessAsUser`, MSI servicing, AV/EDR reactions to a third identity launching UI apps.
(a) stays out of scope.

---

## 5. Cross-cutting

- **Permissions**: no new permission ids needed — justification rides existing
  `requests.view/approve/deny` (`src/lib/permissions.ts:2-23`); policy flag rides
  `policies.manage`. Optional later: `policies.manage` gating of the flag is enough; adding a
  permission for a checkbox is ceremony.
- **Dashboard surfacing**: `dashboardPayload` (`src/lib/metrics.ts`, consumed at
  `src/app/(console)/dashboard/page.tsx:11,34-66`) already counts statuses; add one card row
  "modes mix": counts of allow/deny/require_approval(+flag)/JIT policies so admins see posture at
  a glance (S).
- **Migration safety**: strictly additive `ensureColumn` calls appended after
  `schema.ts:146-147`; no backfill required (NULL justification = legacy row);
  `requestFromRow` tolerates missing columns already via defaults (`src/lib/db/requests.ts:36-37`
  pattern).
- **Test seams**: engine tests in vitest for justifyRequired propagation and deny-reason mapping
  (mirror `src/lib/evaluate.test.ts`, `src/lib/policy.test.ts`); rpc validation tests for
  `justification` cap/sanitize (mirror the uac-canceled checks `rpc.test.ts` style); C# side is
  covered by `scripts/smoke-agent-build.sh` (net48 publish of agent+helper) and manual
  `scripts/smoke-windows-client.ps1`.

### Real-Windows checklist (blocks several items above)

.msi launch failure reproduction · justification dialog STA/threading under consent-watch ticks ·
deny reason display end-to-end · (if prototyped) `PrivGateElev` batch-token desktop access,
profile load, job-object attach on a foreign token.

---

## 6. Phases — each independently shippable

| Phase | Content | Size | Risk |
|---|---|---|---|
| P1 | Deny polish: surface server reason + policy name in tray/console (§3.1-3.2) | S | Low |
| P2 | `.msi` wrap fix (msiexec pattern) behind smoke verification (§1.1) | S | Medium (needs WinVM proof) |
| P3 | Justification, server half: columns, types, rpc cap, queue/device rendering, policy flag + form (§2 table minus agent UI) | M | Low-Medium |
| P4 | Justification, agent half: themed prompt in tray flow, pipe payload field, helper flag (§2) | M | Medium (WinForms + real-desktop testing) |
| P5 | Dashboard modes-mix card + docs note on SYSTEM-in-session launch model (§5) | S | Low |
| P6 | Version-range matching investigation/backlog (§1.2) | L | Low (deferred) |
| P7 | `PrivGateElev` prototype behind config flag, lab-gated (§4b) | L | High (unknowns above) |

Ordering rationale: P1/P2/P5 are pure polish with immediate UX payoff; P3+P4 ship the flagship
parity feature (justification) and can land separately since NULL-tolerant schema means either
half alone is coherent; P6/P7 stay parked until field demand or lab access exists.
