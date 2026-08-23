# Windows VM lab

The Elevation Broker is a Windows SYSTEM service. This Mac cannot run it.

## Supported OS

| Desktop | Server |
|---------|--------|
| Windows 7 SP1 | Windows Server 2008 R2 SP1 |
| Windows 8.1 | Windows Server 2012 / 2012 R2 |
| Windows 10 | Windows Server 2016 |
| Windows 11 | Windows Server 2019 / 2022 / 2025 |

**Prerequisite:** .NET Framework 4.8 must be installed.
- Windows 10 version 1903+ and Windows Server 2019+ ship with 4.8 pre-installed.
- For older systems (Win 7 SP1, Win 8.1, Server 2008 R2 SP1 – Server 2016), download:
  <https://go.microsoft.com/fwlink/?LinkId=2085155>
- The installer script (`Install-PrivGate.ps1`) checks the registry and exits with a clear
  error if .NET Framework 4.8 is absent.

> **Windows Server 2008 (non-R2)** is **not** supported. That OS tops out at .NET Framework 4.6
> and would need a separate build; contact your administrator.

## One-time setup

1. Supported Windows VM (see table above), hybrid-joined or domain-joined test user **without** local Administrators.
2. If not pre-installed, install [.NET Framework 4.8](https://go.microsoft.com/fwlink/?LinkId=2085155).
   The .NET **SDK** is only needed if you want to compile from source on the VM; it is **not**
   required when using the pre-built client MSI or deployment script.
3. On **Devices**, download the **MSI** or the **deployment script**. The console address is already in the file. Install it elevated on the VM; the client registers the hostname.
4. On the VM, run `Install-PrivGate.ps1` from an **elevated** PowerShell.
5. As the standard user, run `PrivGate.Helper.exe --elevate "C:\path\app.exe"`.

To install from a repo checkout instead of the zip (requires .NET SDK on the VM):

```bat
cd agent
dotnet build -c Release -f net48
sc create PrivGateBroker binPath= "%CD%\bin\Release\net48\PrivGate.Agent.exe" start= demand
sc start PrivGateBroker
```

## Checks

From a repo checkout or after copying `scripts/smoke-windows-client.ps1` onto the PC, run elevated:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-windows-client.ps1
```

Manual extras:

- Allowlisted signed MSI elevates; `powershell.exe` is denied.
- Unlisted EXE appears on the dashboard; after approve, the helper already waiting on the PC elevates (live WebSocket). If the socket is down, run the helper again.
- JIT 15 minutes: user is added to Administrators when the grant is pushed (or on the next helper call); after expiry, membership is gone **with the API stopped** (local scheduled task). Console revoke is pushed immediately. During JIT the broker does **not** launch the file as SYSTEM — re-run the app so UAC can prompt.


Do not install Microsoft EPM on the same VM.

## What cannot be verified on macOS

Building with `dotnet build` produces the `.exe` cross-platform (SDK is cross-platform), but end-to-end
functionality requires a Windows VM:

- Named-pipe communication between `PrivGate.Helper.exe` and the broker service
- Authenticode publisher extraction (`X509Certificate.CreateFromSignedFile`)
- Job object child-process restriction (`AssignProcessToJobObject`)
- `schtasks.exe` JIT expiry scheduling
- `net localgroup Administrators` add/remove
- Windows service install/start via `sc.exe`
