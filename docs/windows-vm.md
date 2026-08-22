# Windows 11 VM lab

The Elevation Broker is a Windows SYSTEM service. This Mac cannot run it.

## One-time setup

1. Windows 11 22H2+ VM, hybrid-joined or domain-joined test user **without** local Administrators.
2. Install [.NET 8 SDK](https://dot.net) unless the zip already contains `PrivGate.Agent.exe`.
3. On **Devices**, set the control plane URL the VM can reach, enroll the hostname, and download the installer zip.
4. On the VM, run `Install-PrivGate.ps1` from an **elevated** PowerShell.
5. As the standard user, run `PrivGate.Helper.exe --elevate "C:\path\app.exe"`.

To install from a repo checkout instead of the zip:

```bat
cd agent
dotnet build
sc create PrivGateBroker binPath= "%CD%\bin\Debug\net8.0\PrivGate.Agent.exe" start= demand
sc start PrivGateBroker
```

## Checks

- Allowlisted signed MSI elevates; `powershell.exe` is denied.
- Unlisted EXE appears on the dashboard; after approve, helper can elevate once.
- JIT 15 minutes: user is added to Administrators; after expiry, membership is gone **with the API stopped** (local scheduled task).

Do not install Microsoft EPM on the same VM.
