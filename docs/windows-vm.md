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
4. On the VM, run `Install-PrivGate.ps1` from an **elevated** PowerShell if you used the script instead of the MSI. After that, **PrivGate Client** appears in Apps & Features. Uninstall there, or run `C:\Program Files\PrivGate\Uninstall-PrivGate.ps1` elevated. If this PC was enrolled with an older script (no Apps entry):

   ```powershell
   Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
   sc.exe delete PrivGateBroker
   Remove-Item "$env:ProgramFiles\PrivGate" -Recurse -Force -ErrorAction SilentlyContinue
   Remove-Item "HKLM:\SOFTWARE\PrivGate" -Recurse -Force -ErrorAction SilentlyContinue
   ```
5. The **PrivGateBroker** service runs as SYSTEM in Session 0 and cannot show a window. Install registers HKLM Run `PrivGateTray`, so after the **standard user** signs in a shield appears near the clock. Do **not** open Disk Management from the Start menu — that path never talks to PrivGate by itself. Right-click the shield → **Request Disk Management…** (or **Request a program…**). The tray waits for an approver, then opens the snap-in on **this** desktop. If the user hits stock UAC (Start menu, Explorer) and **cancels**, the tray waits until `consent.exe` has exited (the secure desktop is gone), then offers to request the program through PrivGate. That request is what shows up on **Devices → Could not elevate**. PrivGate does not hook or dismiss the UAC dialog, and Windows does not name the file on cancel — the user picks Disk Management or browses to the program. CLI: `PrivGate.Helper.exe --elevate "C:\Windows\System32\diskmgmt.msc"`.
6. JIT still adds the account to local Administrators (`net localgroup` with a `*SID`). That membership is for a **future** logon token. You do **not** need to sign out to use Disk Management: request it from the tray and, after approval (or while JIT is already on), the broker starts `mmc.exe` in your session. Sign-out is only required if you want Start-menu shortcuts and UAC to treat you as an admin.

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
- JIT 15 minutes: user is added to Administrators when the grant is pushed (or on the next helper call); `net.exe` uses `*SID` so the SAM add actually succeeds. After expiry, membership is gone **with the API stopped** (local scheduled task). Console revoke is pushed immediately. Request Disk Management from the tray to open it on this desktop without signing out. The tray balloons when JIT starts or an approval is waiting.


Do not install Microsoft EPM on the same VM.

## Troubleshooting

The broker writes everything to `%ProgramData%\PrivGate\broker.log`
(10 MB rotation into `broker.log.1`–`.8`). Open it from the tray shield
right-click → **Open log**, or check live state via right-click → **Status**
(pipe state, last evaluate, JIT window, service status). Reading tips — what
pending/reconnect/JIT lines mean and when a missing UAC-cancel offer is normal —
are in the [agent runbook](../agent/README.md#logs-and-status-troubleshooting-runbook).

Quick triage order: tray **Status** first (is the pipe up? is the service
running?), then `broker.log` for the last evaluate, then the console's
**Devices** page (host offline usually means WebSocket/HMAC, not the log).

## What cannot be verified on macOS

Building with `dotnet build` produces the `.exe` cross-platform (SDK is cross-platform), but end-to-end
functionality requires a Windows VM:

- Named-pipe communication between `PrivGate.Helper.exe` and the broker service
- Authenticode publisher extraction (`X509Certificate.CreateFromSignedFile`)
- Job object child-process restriction (`AssignProcessToJobObject`)
- `schtasks.exe` JIT expiry scheduling
- `net localgroup Administrators` add/remove
- Windows service install/start via `sc.exe`
