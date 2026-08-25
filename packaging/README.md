# Management console installers

Published binaries land on **GitHub Releases** after the Console installers workflow succeeds (not on pull requests). Each OS is a native installer file (EXE, MSI, pkg, deb) — not a zip of the product.

- Push to `main` (or **Run workflow**) updates the **nightly** pre-release. `v0.1.0` stays the latest stable until you tag.
- Push a tag `vX.Y.Z` to publish that version as the latest release.
- CI builds `PrivGate-Client.msi` once (Ubuntu packages `msitools` and `wixl` — they split on 24.04) and copies it into every console installer (`agent/dist`). After install, **Devices** brands that file with this console’s URL and enrollment token. The running console does not need `wixl`.

This folder is how maintainers rebuild the same files locally.

```bash
bash packaging/build.sh
```

On macOS, install WiX tooling only if you are packaging locally and do not already have a CI-built client MSI:

```bash
brew install msitools   # provides wixl
# Ubuntu 24.04: sudo apt-get install -y msitools wixl
bash packaging/build.sh
```

If `agent/dist/PrivGate-Client.msi` (or `dist/client-msi/PrivGate-Client.msi`) is already present, `build.sh` ships it without calling `wixl`. Day-to-day `npm run dev` does not need `wixl` after you copy that file. If both the MSI and `wixl` are missing, packaging exits 1. Local experiments only: `PRIVGATE_ALLOW_NO_CLIENT_MSI=1`.

Set `PRIVGATE_TARGETS=windows`, `macos`, or `linux` to build one OS. Artifacts land in `dist/installers/`.

| OS | File | Install |
| --- | --- | --- |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.exe` | Run as Administrator. Registers Windows service `PrivGateConsole`. |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.msi` | `msiexec /i …` then `install-service.cmd` in `C:\Program Files\PrivGate` if the service is not started. |
| macOS | `PrivGate-Console-*-macos-*.pkg` | Open the package (admin). launchd unit `com.privgate.console`. |
| Linux amd64 | `privgate-console_*_amd64.deb` | `sudo dpkg -i …` (systemd user `privgate`). |

A Linux `.tar.gz` is optional for local builds (`PRIVGATE_SKIP_TARBALL` is unset). GitHub Releases do not include it.

The installer prompts for **bind address**, **management web port**, and **client/broker port**. Secrets are generated automatically (`AUTH_MODE=local`). Data: `%ProgramData%\PrivGate`, `/Library/Application Support/PrivGate`, or `/var/lib/privgate`. Set `PRIVGATE_BIND=127.0.0.1` at install to listen on this machine only. There is no demo login. Open `/setup` in the browser to create the Master Admin. Connect Entra ID and/or on-premises Active Directory later under Configuration → Integrations; each is optional.

## Upgrade the management console

Install the newer package over the old one. Do not uninstall first. One command, no manual steps — see [docs/updating.md](../docs/updating.md) for the full procedure, the shipped updater scripts (`update-server.sh` / `.ps1`), and rollback.

| OS | Command |
| --- | --- |
| Windows EXE | Run `PrivGate-Console-*-win-x64.exe` as Administrator (or `/S`). Same install directory. |
| Windows MSI | `msiexec /i PrivGate-Console-*-win-x64.msi` (same UpgradeCode; replaces the previous product). |
| macOS | Open the new `.pkg` (or `sudo installer -pkg … -target /`). |
| Linux | `sudo dpkg -i privgate-console_*_amd64.deb` |

What stays: SQLite and `console.env` (secrets, bind, ports) under the platform data directory. The service is stopped, app files and the bundled Node runtime are replaced, then the service starts again.

The stop is graceful: on SIGTERM the console stops accepting requests, closes agent WebSockets with code 1001, and checkpoints/closes SQLite before exit. Installers also stop consoles started by hand — Windows runs `service-ctl.cmd stop-all`, and the macOS preinstall / Linux preinst drain stray `/opt/privgate/bin/node` processes — which is what used to fail updates with "the management process is running and cannot be updated".

A stop *request* returning is not a stopped service, which is what used to fail Windows upgrades with "service is still running" / "cannot delete the service". The Windows installers therefore never trust a fire-and-forget stop:

- `service-ctl.cmd` polls until the SCM reports `Stopped` (~20s cap), then escalates to `taskkill /F /T` on the `PrivGateConsole.exe` wrapper PID, then polls again; hand-started `node.exe` from the install dir gets graceful taskkill → bounded drain → force. Polling uses `Get-Service` status enums, so it is locale-independent (do not parse localized `sc query` text).
- Upgrades are **stop → swap files → start** with the same WinSW service id (`PrivGateConsole`). Nothing deletes or recreates the service: the MSI's `ServiceControl` is stop-only (no `Remove=` attribute) and NSIS only ever runs WinSW `install`/`start`, never `uninstall`, outside explicit uninstall.
- Installers are self-sufficient: the NSIS setup extracts **its own** current copy of `service-ctl.cmd` to `$PLUGINSDIR` and runs it against `$INSTDIR` (an older on-disk copy may lack newer verbs such as `stop-all`). `update-server.ps1` re-verifies quiescence itself after calling the on-disk script for the same reason.
- If a file is still locked when the swap starts (dying process, wedged drain), the NSIS setup renames it aside (`*.old-N`) instead of failing — Windows refuses to delete a running exe but allows renaming it — and purges the leftovers on the next run.
- The MSI schedules stray-stop before file costing (`Before="InstallValidate"`), so silent `/qn` updates do not hit a files-in-use dialog.

To exercise the wait loop off-box, shim the toolchain on PATH with fake `sc.exe`/`taskkill.exe` that drive a state machine (Running → StopPending → Stopped, plus a wedged variant that never leaves StopPending), run `service-ctl.cmd stop-all <dir>` against an empty target dir, and assert: quiet inside ~20s in the normal case, exactly one forced kill then quiet in the wedged case, immediate no-op when no service object exists.

What does not stay: files you added by hand under the install prefix (`C:\Program Files\PrivGate`, `/opt/privgate`). Change listen settings after upgrade in `console.env` (or `dpkg-reconfigure privgate-console` on Linux), then restart the service.

Uninstall removes the application and service only. Data directories are left in place so a later install is still in-place — this includes the Windows EXE uninstaller, the Linux deb (`remove`), and the macOS pkg. Delete the data directory yourself if you want a clean slate: `%ProgramData%\PrivGate`, `/Library/Application Support/PrivGate`, or `/var/lib/privgate`. On Linux only an explicit purge deletes data: `sudo dpkg -P privgate-console`. The data directory holds `privgate.db` **and** `console.env`; losing either forces every enrolled PC to re-enroll (see [docs/backing-up.md](../docs/backing-up.md)), so back both up before deleting anything.

The MSI copies files and stops/starts `PrivGateConsole` when that service already exists. If you installed from MSI and the service was never registered, run `install-service.cmd` in `C:\Program Files\PrivGate` once.

## Windows client MSI (Intune / SCCM / NinjaOne)

Download the MSI from the **same** console you will enroll against. Devices writes this console’s URL and the shared enrollment token into the file. Do not reuse an MSI from another console.

Silent install (per-machine, service `PrivGateBroker`, registry `HKLM\SOFTWARE\PrivGate\Client`):

```text
msiexec /i PrivGate-Client.msi /qn /norestart
```

| Tool | Notes |
| --- | --- |
| Intune | Line-of-business MSI, required, 64-bit, silent. Detection = UpgradeCode `b4d9f2c1-8e3a-4d02-af5b-2c3d4e5f6071` or ARP name **PrivGate Client**. |
| SCCM / NinjaOne / GPO | Same `msiexec /i … /qn`. |
| Uninstall | `msiexec /x {ProductCode} /qn` or Apps & Features. |

The WiX source also accepts PUBLIC properties `APABASE` and `ENROLLMENTTOKEN`. Devices slot-patch is enough for the common case.

PowerShell (`Install-PrivGate.ps1`) is the imaging-script fallback. After install it writes **PrivGate Client** into Apps & Features and `C:\Program Files\PrivGate\Uninstall-PrivGate.ps1`. Quiet: that script with `-Quiet`. Older script-only installs have no Apps entry; stop/delete `PrivGateBroker` and remove `C:\Program Files\PrivGate` plus `HKLM\SOFTWARE\PrivGate`.

## Windows 10 — endpoint broker smoke

1. Start the console from a GitHub Release installer.
2. Sign in with the Master Admin created at `/setup`. On **Devices**, download the MSI or the deployment script (one file, console address included).
3. On the PC, install that file elevated (`msiexec /i PrivGate-Client.msi /qn` for RMM). The client registers the hostname.
4. Copy `scripts/smoke-windows-client.ps1` to the PC and run it elevated.
