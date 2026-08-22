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

## Install the management console

Native installers (Windows EXE + MSI, macOS PKG, Linux DEB) are built with:

```bash
bash packaging/build.sh
```

See [packaging/README.md](packaging/README.md). Lab/dev can still use `npm run dev`.

## Windows client (Elevation Broker)

On this Mac:

```bash
bash scripts/smoke-agent-build.sh
```

On a Windows 10 PC after installing the device zip from **Devices**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-windows-client.ps1
```


## Production

Set `AUTH_MODE=entra` and Azure AD app roles `PrivGate.Approver` / `PrivGate.PolicyAdmin` (token claim `Approver` / `PolicyAdmin`). Turn on Conditional Access MFA. Do not run this broker on a device that already has Microsoft EPM.

The server refuses to start with the development secrets in place:

```bash
SESSION_SECRET=$(openssl rand -base64 48)
TICKET_SIGNING_KEY=$(openssl rand -base64 48)
DEVICE_SECRET_KEY=$(openssl rand -base64 48)
```

`npm start` binds loopback. See [docs/threat-model.md](docs/threat-model.md) for
`PRIVGATE_PUBLIC_ORIGIN`, `PRIVGATE_TRUSTED_HOSTS`, `PRIVGATE_TRUST_PROXY`, and the
documented residual risks.
