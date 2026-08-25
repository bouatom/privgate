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

## In-console updates (one click)

Once versioning discipline is in place (every payload carries a build-stamped
`version.json` next to `host.cjs`; releases ship a `sha256sums.txt` covering
their artifacts — both produced by `packaging/build.sh` and enforced by
`artifact-check.cjs`), the console can update itself:

1. **Scheduled check** — shortly after boot and then every six hours
   (`PRIVGATE_UPDATE_SWEEP_INTERVAL_MS`, disable with
   `PRIVGATE_DISABLE_SELFUPDATE_SWEEP=1`) the console queries GitHub
   (`repos/bouatom/privgate/releases`, unauthenticated). When a newer release
   exists, a **badge pill appears in the side pane** above Dashboard and an
   audit event `console.update.available` is recorded once per new version.
   Open consoles update their badge live over SSE. A GitHub rate limit (403)
   puts checking into a 10-minute backoff instead of retry-looping.
2. **Channels** — Configuration → Updates → *Release channel*:
   * **Official**: non-prerelease GitHub releases only. Recommended.
   * **Nightly**: three-segment versions (`0.2.13`) published as GitHub
     *prereleases*, seen first by this channel. Switching channels re-checks
     immediately; saving requires the `configuration.update` permission and is
     audited (`console.update.channel`).
3. **Apply** — the *Update to x.y.z* button downloads the platform asset to
   `<data dir>/updates/` **and verifies its SHA-256 against the release's
   `sha256sums.txt` entry before anything else happens**; on mismatch the
   update aborts with nothing changed. It then answers `202 {started:true}`,
   spawns the shipped updater detached
   (`update-server.ps1 -Installer … -Sha256 …` /
   `update-server.sh --deb|--pkg … --sha256 …`), logs to
   `<data dir>/updates/apply.log`, and stops tracking state in memory — the
   updater's job includes stopping this very web process, so progress is
   parsed back from disk by GET `/api/configuration/update/status`
   (`running` / `succeeded` / `failed` / `stale`). The console comes back
   healthy on the new version via the normal stop → swap → start → health
   check sequence above.

Platform notes: Windows (WinSW LocalSystem) and macOS (launchd root daemon)
can run the whole flow from the browser. The Linux systemd unit is sandboxed
to the unprivileged `privgate` user on purpose, so in-console apply there is
refused; use `sudo /opt/privgate/update-server.sh --deb <file>`. Any admin
sees the badge and the Updates panel, but changing the channel or applying an
update requires the `configuration.update` permission (Master Admin and
Policy Admin have it).

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

### "Installer mentions tmp / write errors"

Early-phase messages naming a temp folder map to one of these. None of them
touch your data directory.

| Warning text (typical) | Cause | Safe? |
| --- | --- | --- |
| EXE: `Error writing to file: C:\Users\<you>\AppData\Local\Temp\…` (very first step) | NSIS extracts its self-contained `service-ctl.cmd` into `$PLUGINSDIR` under the admin user's `%TEMP%`; antivirus, AppLocker script rules, or a full disk can block it | **No** — the stop step was skipped; expect follow-on "cannot delete/write" errors. Whitelist the installer or use the MSI |
| EXE: `Stopping the running console returned code N … file copies may report write errors` (new builds) | The stop-all step itself failed; installer now warns instead of failing silently later | Continue only if you stopped the service manually; otherwise abort |
| MSI: error 1303/1334 or paths under `C:\Windows\Temp\{GUID}` | Windows Installer stages the embedded cab there as SYSTEM; broken ACLs on `C:\Windows\Temp` or low disk space cause this before any PrivGate code runs | Fix `C:\Windows\Temp` ACLs/free space, then retry — safe to rerun |
| Linux/macOS updater or maintainer script: `cannot create a temp file` / `mktemp` errors naming `/tmp`, `/var/tmp` | Temp dir read-only or full while staging settings INI / deb verification dir | Now **safe**: scripts fall back to a scratch dir beside the data dir and continue; postinstall may print `using default bind/ports` — re-apply custom ports in `console.env` afterwards |
| Access-denied on `%ProgramData%\PrivGate` or `/var/lib/privgate` during update | Previous manual ACL/ownership edits on data/log dirs, not the installer | Reset inheritance to machine defaults; installers create these dirs with default ACLs if absent |

Temp files used by installers/updaters live beside their target where
possible (`mktemp` in the platform data directory for settings staging,
deb verification under `/var/lib`); nothing is written to the running
install's prefix before verification passes.
