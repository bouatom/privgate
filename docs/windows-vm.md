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
3. On **Devices**, download the **MSI** or the **deployment script** from the **same** console you will enroll against. The console address and enrollment token are already in the file. Install it elevated on the VM; the client registers the hostname.

   Silent MSI (Intune / SCCM / NinjaOne / GPO):

   ```text
   msiexec /i PrivGate-Client.msi /qn /norestart
   ```

   Intune: line-of-business MSI, required, 64-bit. Detection = UpgradeCode `b4d9f2c1-8e3a-4d02-af5b-2c3d4e5f6071` or ARP name **PrivGate Client**. Uninstall: `msiexec /x {ProductCode} /qn` or Apps & Features. Optional PUBLIC properties `APABASE` and `ENROLLMENTTOKEN` exist in the WiX; Devices slot-patch is enough for the common case.
4. On the VM, run `Install-PrivGate.ps1` from an **elevated** PowerShell if you used the script instead of the MSI.
5. As the standard user, run `PrivGate.Helper.exe --elevate "C:\path\app.exe"`.
6. Double-click `PrivGate.Agent.exe` for a tray status window (connection, last error, recent elevation requests). If the **PrivGateBroker** service is already running, that window attaches to it instead of starting a second broker. `--console` still runs in a terminal.

The console **Devices** page is live only while the broker’s WebSocket is accepted. Native Windows sockets do not send an `Origin` header; a previous check treated that as `agent.ws.origin-rejected` and left the hostname **offline**. HMAC on the upgrade is the real gate.

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
