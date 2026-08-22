# Management console installers

Build native packages for the PrivGate **control plane** (not the Windows endpoint broker).

```bash
# .NET SDK for the broker lives in .tools/dotnet (no sudo)
bash scripts/smoke-agent-build.sh

# Console: Windows EXE + MSI, macOS PKG, Linux DEB + tar.gz
bash packaging/build.sh
```

Artifacts land in `dist/installers/`.

| OS | File | Install |
| --- | --- | --- |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.exe` | Run as Administrator. Registers Windows service `PrivGateConsole`. |
| Windows 10/11 x64 | `PrivGate-Console-*-win-x64.msi` | `msiexec /i …` then `install-service.cmd` in `C:\Program Files\PrivGate` if the service is not started. |
| macOS | `PrivGate-Console-*-macos-*.pkg` | Open the package (admin). launchd unit `com.privgate.console`. |
| Linux amd64 | `privgate-console_*_amd64.deb` | `sudo dpkg -i …` (systemd user `privgate`). |
| Linux amd64 | `PrivGate-Console-*-linux-x64.tar.gz` | Unpack under `/opt/privgate`, copy `packaging/linux/privgate.service`. |

The process binds **127.0.0.1:3000** by default. Data and generated secrets: `%ProgramData%\PrivGate`, `/Library/Application Support/PrivGate`, or `/var/lib/privgate`. Edit `console.env` there for `AUTH_MODE=entra` and bind address.

## Windows 10 — endpoint broker smoke

1. Start the console (`npm run dev` or an installer above).
2. Log in as `ada@contoso.test`, enroll the PC, download the device zip (includes `PrivGate.Agent.exe` when `agent/dist` was published).
3. On the PC, elevated PowerShell: `Install-PrivGate.ps1`.
4. Copy `scripts/smoke-windows-client.ps1` to the PC and run it elevated.
