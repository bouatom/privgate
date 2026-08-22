# Specification: Smoke, harden, and package PrivGate

**State:** approved (full-auto 2026-08-22)  
**Project:** privgate  
**Pipeline:** NEXUS Phase 3–5 overlay on the existing approved product spec (`docs/SPEC.md`)

## Deliverables

1. Windows **client** (Elevation Broker) smoke harness the Win10 lab PC can run, plus Mac-side `dotnet publish` of `net48` binaries.
2. Defensive vulnerability scan of the control plane and agent (SAST, dependency audit, secret/config fail-closed). No exploit payloads.
3. Bug remediation for issues found in smoke, scan, or code review.
4. **Management console** native installers:
   - Windows: `.exe` (NSIS) and `.msi` (WiX/`wixl`)
   - macOS: `.pkg`
   - Linux: `.deb` + systemd unit (and a portable `.tar.gz`)
5. Updated runbooks so a lab admin can install the console without `npm run dev`.

## Acceptance criteria

1. `dotnet publish` of `agent/` succeeds on this Mac and produces `PrivGate.Agent.exe` + `PrivGate.Helper.exe`.
2. `scripts/smoke-windows-client.ps1` exists with checks a Win10 admin can run after installing the broker zip (service present, pipe, helper `--elevate` deny path, hard-ban, no UAC disable).
3. Production process **refuses to start** without `SESSION_SECRET`, `TICKET_SIGNING_KEY`, and `DEVICE_SECRET_KEY` (min length 32). Development defaults remain for `AUTH_MODE=development` / unset.
4. `npm audit` high/critical issues in production deps are fixed or documented with justification.
5. Existing `npm test && npm run typecheck && npm run lint` stays green.
6. `packaging/build.sh` (or documented equivalent) produces Windows EXE, Windows MSI, macOS PKG, and Linux DEB artifacts under `dist/installers/`.
7. Installed console listens on a configurable bind (default loopback) and stores SQLite under a platform data directory — not the installer’s working copy of source.
8. No UAC bypasses, stored admin passwords, or `runas /savecred`.

## Interfaces

- Client still enrolls via Devices → installer zip + HMAC `/api/agent/*`.
- Console installer wraps Next.js **standalone** output + bundled Node runtime + OS service (WinSW / launchd / systemd).
- First-boot writes secrets into the data directory if missing (production-quality random), never into the git tree.

## Constraints

- This Mac cannot execute the SYSTEM broker; Win10 is the runtime smoke host.
- MSI/EXE **build** should work from macOS where tools allow (`makensis`, `wixl`/msitools); otherwise generate sources plus a Win10 `build-msi.ps1`.
- PEDM product: do not add kernel hooks or UAC interception.

## Units of work

1. **Smoke** — install .NET SDK, publish agent, Win10 smoke script, include prebuilt bins in device zip when present.
2. **Bugs** — logic/edge/integration defects in console + agent.
3. **Vuln** — secrets fail-closed, crypto key derivation, host-header trust, JSON parse, audit of APIs.
4. **Package** — standalone Next + Node + Windows/macOS/Linux installers.
5. **Gate** — test/lint/typecheck + installer dry-run evidence.
