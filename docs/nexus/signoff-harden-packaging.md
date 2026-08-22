# Sign-off — smoke, harden, package (2026-08-22)

**Status:** complete enough to install and lab-smoke; Windows 10 runtime of the broker still requires the lab PC.

## Artifacts (`dist/installers/`)

- `PrivGate-Console-0.1.0-win-x64.exe` (NSIS)
- `PrivGate-Console-0.1.0-win-x64.msi`
- `PrivGate-Console-0.1.0-macos-x86_64.pkg`
- `privgate-console_0.1.0_amd64.deb`
- `PrivGate-Console-0.1.0-linux-x64.tar.gz`

Rebuild: `bash packaging/build.sh`

## Client smoke

- .NET SDK 8 lives in `.tools/dotnet` (no sudo). `bash scripts/smoke-agent-build.sh` publishes `agent/dist/*.exe`.
- Win10: `scripts/smoke-windows-client.ps1` after `Install-PrivGate.ps1`.

## Hardening applied

- Production secrets fail-closed (`src/lib/secrets.ts` + `instrumentation.ts`)
- HKDF for device-secret encryption and per-device ticket keys
- Origin not taken from untrusted `X-Forwarded-*` unless allowlisted
- JIT tickets grant local admin only; broker does not SYSTEM-launch the payload
- Helper uses the current Windows user SID
- Agent project no longer compiles `helper/` into the broker
- Device zip includes published binaries at zip root when `agent/dist` exists
- `npm audit --omit=dev`: 0 (postcss/sharp overrides)

## Quality

- `npm test` / `typecheck` / `lint` green after Next 15.5.23
