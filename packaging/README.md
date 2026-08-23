# Management console installers

Published binaries are attached to **GitHub Releases** and to **Actions artifacts** on the Console installers workflow (`workflow_dispatch` or a push that touches the console/packaging). This folder is how maintainers rebuild them locally.

```bash
bash scripts/smoke-agent-build.sh
bash packaging/build.sh
```

Artifacts land in `dist/installers/`. CI uploads the same files from `dist/installers/` after `bash packaging/build.sh`.

| OS | File | Install |
| --- | --- | --- |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.exe` | Run as Administrator. Registers Windows service `PrivGateConsole`. |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.msi` | `msiexec /i …` then `install-service.cmd` in `C:\Program Files\PrivGate` if the service is not started. |
| macOS | `PrivGate-Console-*-macos-*.pkg` | Open the package (admin). launchd unit `com.privgate.console`. |
| Linux amd64 | `privgate-console_*_amd64.deb` | `sudo dpkg -i …` (systemd user `privgate`). |
| Linux amd64 | `PrivGate-Console-*-linux-x64.tar.gz` | Unpack under `/opt/privgate`, copy `packaging/linux/privgate.service`. |

The installer prompts for **bind address**, **management web port**, **client/broker port**, and the **first Master Admin**. Secrets are generated automatically (`AUTH_MODE=local`). Data: `%ProgramData%\PrivGate`, `/Library/Application Support/PrivGate`, or `/var/lib/privgate`. Set `PRIVGATE_BIND=127.0.0.1` at install to listen on this machine only. There is no demo login; if you skip the admin account, open `/setup` in the browser.

## Windows 10 — endpoint broker smoke

1. Start the console from a GitHub Release installer.
2. Sign in with the Master Admin created at install (or `/setup`), enroll the PC, download the device zip (includes `PrivGate.Agent.exe` when `agent/dist` was published).
3. On the PC, elevated PowerShell: `Install-PrivGate.ps1`.
4. Copy `scripts/smoke-windows-client.ps1` to the PC and run it elevated.
