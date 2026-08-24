---
layout: default
title: Updating the management console
---

# Updating the PrivGate management console

Updates are **one command** — no manual process juggling. The console drains
gracefully (SIGTERM): it stops accepting new requests, sends agent WebSockets
a proper close frame (`1001 going away`), checkpoints and closes SQLite, then
exits. Package managers rely on this to swap files safely. Zero downtime is
not attempted; a restart takes seconds.

## What an update does

1. **Stop** the running console (service unit, launchd job, or Windows service
   — plus any console someone started by hand).
2. **Swap** application files under the install prefix. Data is never touched:
   SQLite lives in the platform data directory with `console.env` (secrets,
   bind, ports).
3. **Start** again; schema migrations run automatically at boot.
4. **Health-check**: the management web port must answer before the updater
   reports success.

| Platform | Install prefix | Data directory |
| --- | --- | --- |
| Windows | `C:\Program Files\PrivGate` | `%ProgramData%\PrivGate` |
| macOS | `/opt/privgate` | `/Library/Application Support/PrivGate` |
| Linux | `/opt/privgate` | `/var/lib/privgate` |

## One-command update per platform

Install over the existing copy — do **not** uninstall first:

```bash
# macOS
sudo installer -pkg PrivGate-Console-*-macos-*.pkg -target /

# Linux (deb)
sudo dpkg -i privgate-console_*_amd64.deb
```

```powershell
# Windows (PowerShell, elevated) — EXE or MSI
& 'C:\Program Files\PrivGate\update-server.ps1' -Installer .\PrivGate-Console-0-win-x64.exe
msiexec /i PrivGate-Console-*-win-x64.msi /qn /norestart   # MSI alone also works
```

Or use the shipped updater scripts for verify → stop → swap → start → health
check in one step (they ship inside every payload):

```bash
sudo /opt/privgate/update-server.sh --deb privgate-console_*_amd64.deb
sudo /opt/privgate/update-server.sh --pkg PrivGate-Console-*-macos-*.pkg
```

```powershell
& 'C:\Program Files\PrivGate\update-server.ps1' -Payload .\new-payload-dir
```

The updaters validate the new artifact *before* touching the running install
(`artifact-check.cjs`: required files, bundled node runtime, standalone build
manifest), keep a backup of the previous version directory, and poll the web
port afterwards (`health-check.cjs`). If the health check fails they say so
and print rollback steps instead of pretending success.

### Verifying the download (optional but recommended)

Both updaters accept an expected digest and check it **before** stopping the
running console — a mismatch aborts with nothing changed:

```bash
sudo /opt/privgate/update-server.sh --deb privgate-console_*_amd64.deb \
  --sha256 64-char-hex-digest
```

```powershell
& 'C:\Program Files\PrivGate\update-server.ps1' `
  -Installer .\PrivGate-Console-0-win-x64.exe -Sha256 64-char-hex-digest
```

If a `sha256sums.txt` sits next to the `.deb`/`.pkg`/installer file — or inside
a `--payload`/`-Payload` directory — every listed file is verified
automatically; no flag needed. Compute the digest with `sha256sum` /
`shasum -a 256` (macOS/Linux) or `Get-FileHash -Algorithm SHA256` (Windows).

## Safe rollback

Both updaters keep the previous install next to the live one:

* POSIX: `/opt/privgate.backup-<timestamp>`
* Windows: `C:\Program Files\PrivGate.backup-<timestamp>`

Roll back by swapping the directories back and restarting the service. The
SQLite data directory is never modified by an update, so a rollback cannot
lose approvals, policies, or audit history.

Both updaters prune old `*.backup-*` directories after a healthy update,
keeping the newest two (the backup this run created is never deleted).

Updates do not touch data — but updates are also not backups. Capture
`privgate.db` **and** `console.env` together on a schedule; losing
`console.env` while keeping an old database forces whole-fleet re-enrollment.
Procedure and helper scripts: [backing up the management console](backing-up.md).

## Troubleshooting

* **"The management process is running and cannot be updated"** — happened
  with consoles started by hand (`node host.cjs`), which locked the install
  files. Installers now stop those too (Windows: `service-ctl.cmd stop-all`;
  macOS/Linux: SIGTERM drain in preinstall/preinst). If you still hit it, run
  the platform stop command manually and retry.
* **MSI shows "files in use"** — only possible for very old installs that
  predate the pre-costing stop action; close the console or reboot once.
* **Update finished but port is closed** — check `console.env` in the data
  directory (`bind`, `webPort`) and the service logs
  (`%ProgramData%\PrivGate\logs`, `/Library/Logs/PrivGate`,
  `journalctl -u privgate`).
