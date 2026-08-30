# PrivGate Console UX — Handoff

**Repo:** `/Users/Apple/Projects/privgate` (Next.js app-router; `main` branch; remote `bouatom/privgate`)
**Task:** Complete the P0 console-UX fixes identified by a 4-perspective review (Brand / Technical writer / General user / Graphical). Some P0 edits are already applied and green; the rest are scoped below with exact file/line locations.

**Work with the existing uncommitted tree.** Do NOT stash/rebase/blow it away — it contains completed, green work.

---

## ✅ Already done & verified (in the current uncommitted tree — leave these alone)

1. **Console UX review captured** — 21 screenshots + full text dump at `/tmp/console-ux-shots/` (`console.txt` is the text map of every screen).
2. **P0.2 Updates-page debug dump cleanup** — `src/app/(console)/configuration/updates/updates-client.tsx`:
   - Rewrote `APPLY_PHASE_LABEL.failed` from the raw "The last update FAILED … Abandon the lock below … docs/updating.md" to plain language.
   - Removed the raw `phase: <enum>` token from the "Last apply" panel.
   - Replaced the raw `<pre>` log wall (which leaked base64 `-encodedcommand` PowerShell) with a collapsible `<details>` "View apply log" that **filters out** `cmdline: powershell -encodedcommand` lines.
3. **P0.4 Network "another machine" correctness fix** — added `lanUrls(port, bind)` to `src/lib/listen.ts` (excludes loopback `127.0.0.1/::1/localhost`, returns only LAN-addressable URLs, falls back to loopback if not reachable externally) and switched `src/app/(console)/configuration/network/page.tsx` to use it, with copy now noting `127.0.0.1` only works on the console machine itself (plus a hint when the console is loopback-only).

**Also already in the tree (NOT authored by this session — a concurrent Policies/Elevation consolidation, verified green):** new `src/lib/policies-tabs.ts` (+ `policies-tabs.test.ts`), `allowlists/page.tsx` rewritten to host both "Rules" and "Elevation" tabs, `elevation-settings-client.tsx` moved from `configuration/elevation/` to `allowlists/`, `configuration/elevation/page.tsx` trimmed, and `nav-model.ts` + `permissions.ts` dropped the standalone Elevation config tab / its policies gating. **Do not undo any of this — it is intentional and passes.**

**Baseline quality gates (run on the CURRENT tree, all GREEN):**
- `npm test` → **600 passed / 88 files**
- `npm run typecheck` → clean (0 errors)
- `npm run lint` → run before you finalize

---

## 🎯 Todo list for the other process — complete in this order

### P0 (implement now)

- [ ] **P0.1 — Failure-state visibility (red) for update/audit failures.** The Updates "Last apply" panel and the Audit rows for `device.update.failed` render neutral (no red) despite repeated failures. Make failed update states show an alert/red treatment (e.g. red-bordered panel + red status on the Updates page when `apply.phase === "failed"`; color-code the Audit action text by severity — red for fail events). Reconcile the device version display (device drawer shows `agent v0.3.3 (updating…)` + raw epoch `@1788036841470` while audit says `reported 0.2.1`); remove the raw epoch from the drawer string. Give the Dashboard a failed-update story line instead of only live zeros.

- [ ] **P0.3 — Fix JIT / Elevations / Directory navigation mismatch.** `nav-model.ts` sets Govern → "JIT Access" href=`/directory`, and `/directory/page.tsx` renders `<h1>JIT Access</h1>` + `JitClient`; but `/jit/page.tsx` redirects to `/elevations?tab=jit` (a page titled "Elevations"), and `/users` + `/requests` are dead aliases. **Rule: nav label must equal the rendered heading.** Decide ONE canonical home for JIT (recommend: keep `/directory` = "JIT Access" as the Govern home; make the `/jit` redirect point to `/directory` instead of `/elevations?tab=jit`; and either give `/directory` a real synced user/group list or drop the misleading directory-sync copy). Update `nav-model.ts` + `jit/page.tsx` accordingly.

- [ ] **P0.5 — Canonicalize terminology (partially scoped; apply remaining edits).**
  - `src/app/(console)/elevations/page.tsx:37` — "pending run-requests with risk scoring" → "pending **elevation requests** with risk scoring" (NOT yet applied — do it).
  - `src/app/(console)/allowlists/page.tsx:16` — the Elevation-tab lede `ELEVATION_LEDE` says "Always-allow rules and **Helper requests** are unchanged." The undefined term "Helper requests" must go — recommend → "Always-allow rules and elevation requests are unchanged." (NOT yet applied — do it).
  - Dashboard metric "ALWAYS-ALLOW POLICIES" → "ALWAYS-ALLOW RULES".
  - Align remaining surfaces on the nouns **"always-allow rules"** and **"elevation requests"** (allowlists intro, role-permission category/items, "RULE" chip framing).

### P1 / P2 (do after P0, or ticket them — full list in the UX review)
Audit readability (dotted-ID dropdown, raw JSON details, translate `expected/reported`); device-status jargon (`LIVE UI SILENT`, `UPDATING…`+`auto`, `(unidentified program)` vs `Unidentified program`); one primary action per screen with consistent top-right placement; de-collide risk/action amber + stop overloading green (role badges); "CHILDREN: deny" column rename/tootip; protect "Require Approval Default"; dashboard "0 min" median + dedupe risk widgets; add "create rule from request/log" button on Policies; empty-states styling; tagline unification; P2 demo-data typos (`X` user, `teting`, `Test Admin`, `SMTP password ` trailing space); compounding-deny keyboard confirm; password rule on Create User; risk legend; "Appearances are still recorded" → "Windows UAC prompts are still recorded".

> Full detail of every finding/recommendation is in the review that produced this — reproduce from `/tmp/console-ux-shots/console.txt` and the earlier conversation summary (the four reviews: Brand, Technical writer, General user, Graphical all flagged the P0 set with evidence).

---

## House rules
- Run `npm test && npm run typecheck && npm run lint` before calling anything done.
- Only touch the files listed in the todos — do not disturb unrelated WIP.
- **Never commit/push unless the user asks.** Commit/push/PR goes through GitHub Hygiene only on request.
- Do not edit `$HOME` config. Module caps: one file = one domain, soft 300 / hard 400 lines.
- This is a PEDM control plane: do not add UAC bypasses, stored admin passwords, or `/savecred`.
- Preserve the security-native copy already present (login "Standard users never receive a stored admin password", "Hash + publisher, never filename alone", "Append-only. There is no API to edit or delete events.").
