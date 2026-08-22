# privgate

## Run
- `npm install && npm run dev` — control plane at http://localhost:3000 (login `ada@contoso.test`)
- Connect Entra / AD: Configuration → Integrations
- Notifications: Configuration → Notifications
- First login opens the dashboard (`/dashboard`)
- Devices: enroll a PC, download `Install-PrivGate.ps1`, and inspect events per host
- Windows broker: see `docs/windows-vm.md` and `agent/README.md`
- Console installers (MSI/EXE, macOS pkg, Linux deb): `packaging/README.md`
- Win10 broker smoke: `scripts/smoke-windows-client.ps1` after `bash scripts/smoke-agent-build.sh`

## Test
- `npm test && npm run typecheck && npm run lint`

## Agent rules
- Work only in this repo. Do not edit `$HOME` config unless asked.
- Small change → one specialist card from `~/ai-workspace/agents/cards/`.
- Run tests/lint before calling the work done.
- Commit / push / PR only when the user asks (GitHub Hygiene).
- Never commit `.env`, keys, or secrets.
- This is a PEDM control plane. Do not add UAC bypasses, stored admin passwords, or `runas /savecred`.

## Ignore
See `.cursorignore` and `.gitignore`.
