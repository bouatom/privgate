# privgate

## Run
- `npm install && npm run dev` — control plane at http://localhost:3000; first visit is `/setup` (create the local Master Admin). Brokers use port **3001**
- Bind/ports: installer prompts, or `PRIVGATE_BIND` / `PRIVGATE_WEB_PORT` / `PRIVGATE_AGENT_PORT`. Configuration → Network
- Connect Entra and/or AD independently: Configuration → Integrations. Login shows Entra SSO only after Entra is connected. AD-only, Entra-only, and hybrid are all valid.
- Notifications: Configuration → Notifications
- After the wizard, first login opens the dashboard (`/dashboard`)
- Devices: download an MSI or a deployment script; each PC registers by hostname and keeps a live WebSocket on port **3001** (`/api/agent/ws`)
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

## Module size
- One file = one domain. Soft cap **300** lines, hard cap **400** (enforced by `src/lib/module-size.test.ts`).
- If a change would cross the cap, split first. Barrels (`index.ts`) only re-export.
- Do not dump unrelated helpers into an existing file because it is convenient.

## Ignore
See `.cursorignore` and `.gitignore`.
