# Audit follow-up roadmap

Deferred findings from the four-way audit (client functional / general-user usability /
design-UX / security) at baseline `15faf0b`. Shipped in the same wave: pipe token-SID
binding (S1), launch honesty F1/F2 (`device.launch.*` audits), friendly tray errors +
dialog a11y (U1/U6/U7), themed ConfirmDialog + drawer focus containment (D1/D2).

## Security

| ID | Item | Notes |
|----|------|-------|
| S2 | HardBans canonicalization | Exact-filename match misses trailing-dot / 8.3 alias forms; also scope `PRIVGATE_JIT=1` per-launch instead of process-wide |
| S3 | Per-device enrollment secrets | Shared static enrollment token keyed by hostname; hostname collision returns victim secret; add rotation + rebind approval |
| S4 | Signed console releases | Self-update trusts public GitHub + same-release sha256sums; pin cosign/minisign pubkey before broad fleet rollout |
| S5 | Ticket nonces | `consumeNonce` has zero callers; jit-grant push replayable ≤120 s |
| S6 | Device-HMAC nonce + login throttle | ±5 min skew window allows short replay; no rate limit on `/api/auth/login` |
| S7 | ReDoS-safe argumentPattern | Admin-supplied regex compiled per-evaluate on single-threaded server; use RE2-style or compile-time budget |
| S8 | LDAPS certificate validation | `ad-ldap.ts` sets `rejectUnauthorized:false`; default on, opt-out documented |
| S9 | ProgramData ACL hardening | Explicit `icacls` on `%ProgramData%\PrivGate` so `console.env` is not readable by local Users group |
| S10 | Ops hardening | Audit retention/pruning, pre-auth request body caps, setup bootstrap race lock |

## Client functional

| ID | Item |
|----|------|
| F3 | WS-down telemetry retry queue (cancels/approvals/beats currently drop while offline) |
| F4 | C# runtime test harness (UacClassifier/BrokerHost dispatch/RealtimeChannel/SessionLaunch are compile-gate only) |

## Usability

| ID | Item |
|----|------|
| U2 | Explicit cancel-request affordance in waiting window (closing X abandons pending silently today) |
| U3 | Jargon rewrite across tray/status strings ("named pipe", SID text, "in-process/detached") |
| U4 | Soften offline warning-triangle for transient reconnects |
| U8 | Demote Disk Management hero button; make Browse primary in unidentified flow |

## Design

| ID | Item |
|----|------|
| D3 | Inline-style cleanup toward spacing/section utilities (~120 sites; worst: access/dashboard/updates/setup) |
| D4 | Fleet-table keyboard navigation parity with requests queue |
| D5 | Requests "Rule" stat-card → lede/tooltip copy fix |
| D6 | Busy states for updates polling; pulse skeletons |
| D7 | Audit filter bar layout hardening + clear-filters action |
| D8 | Type-scale tokens replacing inline px headings |

## Known follow-ups from shipped wave

- `access-client.tsx` sits over the 400-line hard cap after mechanical ConfirmDialog swap — split into subcomponents.
- `allowlist-from-request-button.tsx` still uses native confirm() (was outside wave ownership).
