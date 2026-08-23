# Management console installers

Published binaries land on **GitHub Releases** after the Console installers workflow succeeds (not on pull requests). Each OS is a native installer file (EXE, MSI, pkg, deb) — not a zip of the product.

- Push to `main` (or **Run workflow**) updates the **nightly** pre-release. `v0.1.0` stays the latest stable until you tag.
- Push a tag `vX.Y.Z` to publish that version as the latest release.
- CI does not build the Windows client/broker. Enroll PCs from **Devices** after the console is up.

This folder is how maintainers rebuild the same files locally.

```bash
bash packaging/build.sh
```

Set `PRIVGATE_TARGETS=windows`, `macos`, or `linux` to build one OS. Artifacts land in `dist/installers/`.

| OS | File | Install |
| --- | --- | --- |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.exe` | Run as Administrator. Registers Windows service `PrivGateConsole`. |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.msi` | `msiexec /i …` then `install-service.cmd` in `C:\Program Files\PrivGate` if the service is not started. |
| macOS | `PrivGate-Console-*-macos-*.pkg` | Open the package (admin). launchd unit `com.privgate.console`. |
| Linux amd64 | `privgate-console_*_amd64.deb` | `sudo dpkg -i …` (systemd user `privgate`). |

A Linux `.tar.gz` is optional for local builds (`PRIVGATE_SKIP_TARBALL` is unset). GitHub Releases do not include it.

The installer prompts for **bind address**, **management web port**, and **client/broker port**. Secrets are generated automatically (`AUTH_MODE=local`). Data: `%ProgramData%\PrivGate`, `/Library/Application Support/PrivGate`, or `/var/lib/privgate`. Set `PRIVGATE_BIND=127.0.0.1` at install to listen on this machine only. There is no demo login. Open `/setup` in the browser to create the Master Admin. Connect Entra ID later under Configuration → Integrations.

## Upgrade the management console

Install the newer package over the old one. Do not uninstall first.

| OS | Command |
| --- | --- |
| Windows EXE | Run `PrivGate-Console-*-win-x64.exe` as Administrator (or `/S`). Same install directory. |
| Windows MSI | `msiexec /i PrivGate-Console-*-win-x64.msi` (same UpgradeCode; replaces the previous product). |
| macOS | Open the new `.pkg` (or `sudo installer -pkg … -target /`). |
| Linux | `sudo dpkg -i privgate-console_*_amd64.deb` |

What stays: SQLite and `console.env` (secrets, bind, ports) under the platform data directory. The service is stopped, app files and the bundled Node runtime are replaced, then the service starts again.

What does not stay: files you added by hand under the install prefix (`C:\Program Files\PrivGate`, `/opt/privgate`). Change listen settings after upgrade in `console.env` (or `dpkg-reconfigure privgate-console` on Linux), then restart the service.

Uninstall removes the application and service only. Data directories are left in place so a later install is still in-place. Delete the data directory yourself if you want a clean slate.

The MSI copies files and stops/starts `PrivGateConsole` when that service already exists. If you installed from MSI and the service was never registered, run `install-service.cmd` in `C:\Program Files\PrivGate` once.

## Windows 10 — endpoint broker smoke

1. Start the console from a GitHub Release installer.
2. Sign in with the Master Admin created at `/setup`. On **Devices**, download the MSI or the deployment script (one file, console address included).
3. On the PC, install that file elevated. The client registers the hostname.
4. Copy `scripts/smoke-windows-client.ps1` to the PC and run it elevated.
