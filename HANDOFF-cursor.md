# Handoff to Cursor — privgate (Steam/UAC auto-elevate + in-progress state)

> **Repo:** `/Users/Apple/Projects/privgate` — branch `main`, remote `bouatom/privgate`
> **Generated:** 2026-08-29 · **Purpose:** continue the partially-implemented **Windows auto-elevate** work and absorb the other in-flight/recent changes without re-deriving them.
> **Environment:** macOS host, cross-compiling the Windows broker (`.NET Framework 4.8`, `EnableWindowsTargeting`). Management console runs as a Windows service on prod box **10.0.2.25** (console `v0.3.1`, official channel); WS-SOHO-03 test box at **10.0.3.197**.

---

## IMPORTANT — start here before doing anything

1. **Run the quality gates early and often:**
   ```
   npm test && npm run typecheck && npm run lint
   ```
   The server-side tests were green before handoff (see below). Keep them green.
2. **`AGENTS.md` is the governing contract** for this repo. Read it. Notable rules:
   - This is a **PEDM control plane — do NOT add UAC bypasses, stored admin passwords, or `runas /savecred`.** The auto-elevate feature below is carefully scoped to be explicitly-policy-gated and server-authoritative — preserve those guardrails.
   - One file = one domain; soft cap **300 lines**, hard cap **400** (`src/lib/module-size.test.ts` enforces). Split before you cross it.
   - **Commit/push/PR ONLY when the user asks.** Do NOT commit or push unprompted. The user has NOT yet asked for a commit in this session.
   - Never commit `.env`, keys, or secrets.
3. There is **heavy pre-existing uncommitted WIP** in the tree (device groups, update policy, stepup, portals) that predates this session — **do not disturb unrelated files.**

---

## UNCOMMITTED CHANGES in the tree right now (all verified, server-side green)

```
 M src/lib/evaluate.ts                 # NEW: silentAllowForDevice() — side-effect-free allowlist-only verdict
 M src/lib/evaluate.test.ts            # NEW tests for silent-allow (passing)
 M src/lib/realtime/rpc.ts             # NEW 'silent-allow' RPC type + handler
?? src/app/api/agent/silent-allow/     # NEW HTTP route POST /api/agent/silent-allow
 M src/lib/db/jit.ts                   # removed 'user is not JIT eligible' gate (any user can be granted JIT)
 M src/app/(console)/jit/jit-client.tsx # removed u.jitEligible filter (dropdown shows all users)
 M src/lib/self-update-apply.ts        # PROVEN fix: detached: process.platform !== 'win32'
 M src/lib/self-update-apply.test.ts   # updated assertion to match
 M package-lock.json                   # incidental (npm); leave alone unless it matters
```

**Verified:** `npx vitest run src/lib/evaluate.test.ts src/lib/realtime.test.ts` → 11/11 pass; `npm run typecheck` clean; (lint not yet re-run after latest edits — run it).

### Three distinct pieces of work already done in the tree (know which is which)

#### A) JIT for ANY user (DONE, server+UI, uncommitted)
The per-user `jitEligible` opt-in was removed by product decision: **any app user may be assigned a JIT admin window.** Implemented by deleting the backend gate in `src/lib/db/jit.ts` and the `u.jitEligible &&` frontend filter in `jit-client.tsx`. Still excludes **Approvers/PolicyAdmins** as grant *subjects*. JIT still grants full local Administrators for 15–60 min and remains audited.

#### B) In-console update fix (DONE, proven on prod box, uncommitted)
Root-caused the management-console self-update failure: `child_process.spawn(..., { detached: true })` silently breaks the PowerShell updater on Windows (DETACHED_PROCESS kills the child). Fix: `detached: process.platform !== "win32"` in `src/lib/self-update-apply.ts`. **Proven on 10.0.2.25** by running the real `scripts/update-server.ps1` with `detached:false` → full updater output appeared. Separate pre-existing MSI **error 1603** on reinstall was a repro-artifact (file locks on the running service), not the detach bug. The fix must ship in the next official release (currently **not** shipped).

#### C) Auto-elevate for rule-covered apps (IN PROGRESS — this is the main handoff task)
See the full section below. **Server half is DONE+green; client half is NOT started.**

---

## MAIN TASK — Windows "auto-elevate" so UAC doesn't pop for allowlisted apps (e.g. Steam)

### The problem (user report)
On ws-soho-03, an admin created console **elevation rules** (allowlist = "Allow silently") for an app, but **UAC still pops on the client** when the user double-clicks / launches via Start / Steam. Investigation proved why: **PrivGate's elevation is entirely PULL-BASED** — there is NO background watcher intercepting direct launches. Direct launches hit stock Windows UAC (consent.exe) and the broker is never consulted. The allowed path was only tray → "Request a program…" (or JIT + sign-out/in). The user wants direct launches of rule-covered apps to **not show UAC at all** (least user interaction; standard users won't read prompts).

### Agreed design (Mechanism 2 — silent process watcher, chosen by user)
A background watcher **inside the SYSTEM broker service** (`PrivGateBroker`) that:
1. Detects a **newly-started, MEDIUM-integrity (non-elevated)** process owned by the interactive user in an interactive session.
2. Asks the **server** for a **silent-allow** verdict for that exact binary (path + sha256 + publisher + userSid + args).
3. If verdict `allow:true` → **terminate** the non-elevated instance and **relaunch it elevated** into that session via the existing SYSTEM `CreateProcessAsUser` path → **no UAC**.
4. All other verdicts (`pending`, `deny`, active-JIT) → **leave the process running untouched**.

### Security guardrails (MUST preserve — this is the "no UAC bypass" line)
- **Server-authoritative, per event.** The client never trusts its own logic — it asks the server every time.
- **Only an explicit allowlist policy** ("Allow silently", `evaluateElevation` → `decision==="allow"` with `policyId !== "jit"`) yields `allow:true`.
- **NEVER** when decision is `pending` (approval needed), `deny`, hard-banned, or an **active JIT window** (JIT is its own sign-out/in flow — not silent relaunch).
- No prompts, **no stored admin password, no `/savecred`, no token minting** — the elevated relaunch reuses the broker's LocalSystem token via `SessionLaunch.InSession` (exactly like the existing tray flow).
- Loop-safe by construction: the watcher only acts on **medium-integrity fresh starts**; the elevated relaunch is high-integrity so it never re-triggers itself. Plus terminate-before-relaunch and a per-path cooldown to prevent thrash.

### WHY a new side-effect-free server call was needed
The existing `evaluateForDevice` (used by `/api/agent/evaluate` + realtime `evaluate`) **has side effects**: it inserts a `requests` row and queues a notification for `pending`, and inserts a `denied` row for `deny`. If the watcher called it for every medium process the user launches, it would **spam the console's approvals queue / notifications** with fake pending rows. Hence the dedicated `silentAllowForDevice` = a **pure policy lookup with zero side effects** (no request, no notification, no audit).

### Server half — ALREADY DONE (green; don’t redo, but review)
- **`src/lib/evaluate.ts`** → new export `silentAllowForDevice(db, deviceId, body): { allow: boolean; policyId?: string }`. It runs `findUserBySid` → `activeJit` → `evaluateElevation` → returns `allow:true` **only** when `decision==="allow" && policyId !== "jit"`. No inserts/notifications/audit.
- **`src/lib/realtime/rpc.ts`** → added `{ type: "silent-allow"; body: EvaluateBody }` to `AgentRpc` + handler (validates required fields, returns `silentAllowForDevice(...)`). No side effects.
- **`src/app/api/agent/silent-allow/route.ts`** → POST route mirroring `/api/agent/evaluate` (device HMAC auth + 30/60s rate limit + size guard), calling `silentAllowForDevice`.
- **`src/lib/evaluate.test.ts`** → new tests (side-effect-free, allowlist-only, and NOT during active JIT). Passing.

### Client half — NOT STARTED. Implement next in `/Users/Apple/Projects/privgate/agent/`

Key constraints already learned (read these files before coding):
- Repo **agent/ tree is C# (.NET Framework 4.8)**, cross-compiled from macOS. Project: `agent/PrivGate.Agent.csproj` (net48, WinExe, `EnableWindowsTargeting`, refs ONLY System.Net.Http / System.ServiceProcess / System.Windows.Forms / System.Drawing + NuGet System.Text.Json 8.0.5). **No `System.Management`** — do **not** add a WMI `ManagementEventWatcher`; use **pure-Win32 token/process polling** instead (matches existing style; ~1s latency is fine/given).
- Broker is a **SYSTEM service** (Session 0). Tray is the interactive-session UI. The watcher belongs in the **broker**.
- Lifecycle wiring point: **`agent/BrokerHost.cs` `RunAsync`** — currently starts `realtime.RunAsync()` and a 5s `JitWatchdog` tick loop as background tasks. Add the watcher the same way: `_ = Task.Run(async () => ...)`.
- Reuse these existing primitives (already read, do not reinvent):
  - **`UacClassifier.cs`** — has Win32 P/Invokes + patterns: `OpenProcess`, `OpenProcessToken`, `GetTokenInformation`, `TryGetElevationType` (TokenElevationTypeClass=18), `TokenUserSidString`, `QueryFullProcessImageName`, `SafeSessionId`, `StartedRecently`. Follow its **fully-guarded, never-throws, degrade-to-safe** style.
  - **`UacTargetCache.cs` `Native`** (`internal static class Native`, namespace-private): `QueryLimited`/`VmRead`/`TokenQuery` consts, `CommandLineOf(pid)`, `SplitArgs(cmd)`. Usable to capture the original launch **arguments** for the relaunch.
  - **`SessionLaunch.InSession(sessionId, filePath, arguments)`** — SYSTEM `CreateProcessAsUser` into `winsta0\default`; returns `Process?` (null on failure).
  - **`ElevationHost.Launch(filePath, arguments, denyChildren, sessionId=0)`** — the existing elevation entry point; calls `SessionLaunch.InSession` when `sessionId>0`; also does the **HardBans.IsBanned** guard + `Existing Auth.</think>` Authenticode hash/publisher. **`Authenticode.Sha256File(path)`** and **`Authenticode.Publisher(path)`** compute exactly the hash/publisher the server's `silent-allow` RPC requires.
  - **`ApiClient.EvaluateAsync(body, ct)`** + **`RealtimeChannel.EvaluateAsync`** — the pattern for the new RPC call. Note: realtime `EvaluateAsync` **blocks on `pending` waiting for a ticket** — that is why the watcher needs a **separate** `silent-allow` call that returns immediately, never blocking.

#### Concrete client to-do list
1. **`RealtimeChannel.cs`**: add `public async Task<JsonElement> SilentAllowAsync(object body, CancellationToken ct)` → `RpcAsync({ type: "silent-allow", body })` — returns immediately (no `WaitTicketAsync`).
2. **`ApiClient.cs`**: add `SilentAllowAsync(object body, CancellationToken ct)` — realtime first (like `EvaluateAsync`), else HTTP `POST /api/agent/silent-allow` via the existing `SendAsync` (HMAC-signed).
3. **New file `agent/AutoElevateWatch.cs`** — the SYSTEM poller, own file (module cap). Suggested behavior, each ~1s tick:
   - Enumerate `Process.GetProcesses()`; for each candidate: skip `pid<=4`, the broker's own pid, already-seen pids; require `SessionId>0` interactive; require owner SID = an interactive non-SYSTEM user; require **token integrity level == Medium (0x2000)** (add a `TryGetIntegrityLevel` via `GetTokenInformation(TokenIntegrityLevel=25)` + mandatory-label SID last sub-authority) — this is the "would this pop UAC" signal; require the process started recently (~last few seconds) so we only react to fresh launches; skip our own binaries (consent.exe, our helper, broker install path).
   - Compute path → `Authenticode.Sha256File` + `Authenticode.Publisher` (cache by path + last-write-time to avoid re-hashing every tick).
   - Call `api.SilentAllowAsync({ userSid, filePath, fileHash, publisher, arguments? })`. Also `entraOid` if available.
   - If `payload.allow == true` → log to `BrokerLog.Write`, **terminate** the medium-integrity process (guard failures), then `ElevationHost.Launch(path, args, denyChildren:false, sessionId)` to relaunch elevated. Mark pid handled; enforce a **per-path cooldown** (e.g. 30–45s) so child processes don’t thrash.
   - **Every Win32/IO call guarded; never throws out of the loop** (mirror `UacClassifier`). On any server error / uncertainty → do nothing (leave the process running).
   - Default **disabled** unless a config/env flag is set? **Consider an explicit enable flag** (e.g. `AutoElevate: true` in `Cfg`/appsettings or an env var) so the feature is opt-in per device — a prudent default for a PEDM product. Surfacing a set of allowlisted apps to auto-elevate is a policy question; keep it simple and safe for the first cut.
4. **`BrokerHost.cs` `RunAsync`**: instantiate the watcher and start it as a background task alongside realtime + watchdog, passing `cfg`, `api`, and `ct`. Gate it behind the enable flag if you added one.
5. **Build the agent:** cross-compile check from macOS, e.g. `dotnet build agent/PrivGate.Agent.csproj -c Release` (or the repo’s usual windows build script — see `scripts/` / `packaging/`). Confirm the C# compiles for net48. There is **no automated C# test harness** for the broker; validate by build + a dry-run print path (the code already has `[dry-run]` branches guarded by `RuntimeInformation.IsOSPlatform`).
6. **Server quality gates** after any edits: `npm test && npm run typecheck && npm run lint` (the realtime module-size and existing suites must stay green).

### Verify / finishing notes
- Deploying & proving on a real box (e.g. ws-soho-03 10.0.3.197 or 10.0.2.25) requires building the client MSI/zip and installing — see `packaging/README.md` and `docs/windows-vm.md`. Full install validation historically needed an **elevated** run and the broker service restart. This is optional for the handoff; build-green is the gate.
- **Do not commit** unless the user explicitly asks. When they do, use **GitHub Hygiene** (`github-hygiene`) — only that agent may run `git`/`gh`.

---

## In-flight things to keep in mind (not blockers, but don't regress)

- The **JIT-any-user** and **update-fix** changes above are uncommitted in this tree.
- `auto-version.yml` has a long-standing failure (patch-bump workflow, "log not found"); official versions past 0.3.1 were released via **manual tag** `v0.3.2` + workflow dispatch. Not the current task; be aware versions are managed via tags + `dotnet-desktop.yml`.
- **Entra connect** (Option A: replace the "install Azure CLI" bootstrap with a one-time portal-registered public client, device-code sign-in, no CLI) is a **queued later task** — NOT started; do not begin it in this handoff unless explicitly asked.
- Prod console on 10.0.2.25 sees `v0.3.2` as an update on the official channel (the update button previously failed due to the detached bug now fixed in source, but the fix is not yet shipped).

---

## Suggested next step for Cursor
Implement the **client half** (to-do list above), then run `dotnet build -c Release` on the agent and `npm test && npm run typecheck && npm run lint`. Do **not** commit. If you add an enable flag, keep it off by default and document it. When the user says "commit," route through GitHub Hygiene.
