# PrivGate

Admin-controlled privilege elevation for hybrid Active Directory + Entra ID users. Standard users stay non-admin. Admins allowlist signed programs, approve one-shot requests, or open a short JIT window. UAC is not bypassed and admin passwords are not stored on endpoints.

## Run

```bash
cp .env.example .env   # optional; development defaults work
npm install
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login) as `ada@contoso.test`.

## Test

```bash
npm test
npm run typecheck
npm run lint
```

## Layout

- `src/` — Next.js control plane (console + API + SQLite)
- `agent/` — Windows SYSTEM broker + helper (build on a Windows 11 VM)
- `docs/SPEC.md` — GSD spec
- `docs/threat-model.md` — STRIDE
- `docs/openapi.yaml` — API
- `docs/license-audit.md` — why this is custom vs Intune EPM
- `docs/windows-vm.md` — broker lab

Demo seed: allowlisted Contoso Widget MSI, pending Vendor Update.exe, lab device `dev-lab-01`.

Production: set `AUTH_MODE=entra` and Azure AD app roles `PrivGate.Approver` / `PrivGate.PolicyAdmin` (token claim `Approver` / `PolicyAdmin`). Turn on Conditional Access MFA. Do not run this broker on a device that already has Microsoft EPM.
