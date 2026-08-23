# PrivGate Elevation Broker

Windows SYSTEM service. It does **not** disable UAC, store admin passwords, or intercept the UAC dialog.

## Supported OS

| Target | Minimum version | Prerequisite |
|--------|-----------------|--------------|
| Desktop | Windows 7 SP1 | .NET Framework 4.8 |
| Desktop | Windows 8.1, 10, 11 | .NET Framework 4.8 (pre-installed on Win10 1903+) |
| Server | Windows Server 2008 R2 SP1 | .NET Framework 4.8 |
| Server | Server 2012 / 2012 R2 / 2016 / 2019 / 2022 / 2025 | .NET Framework 4.8 (pre-installed on 2019+) |

> **Windows Server 2008 (non-R2)** is **not** supported by this build.
> That OS tops out at .NET Framework 4.6, which requires a separate build with
> Newtonsoft.Json replacing `System.Text.Json` and several additional compatibility shims.

## What it does

1. Standard user runs `PrivGate.Helper --elevate <file>`.
2. Helper talks to the broker over the `PrivGateElevation` named pipe (not over the network as the user).
3. Broker hashes the file, reads Authenticode publisher, and evaluates over a persistent WebSocket (`/api/agent/ws`) with device HMAC. HTTP `/api/agent/evaluate` is the fallback if the socket is down.
4. On an allow ticket it launches **that** file (job object blocks children unless the ticket says otherwise). If the decision is pending, the broker **waits on the socket** for the operator’s approve/deny instead of asking the user to retry.
5. On a JIT ticket — including a JIT grant pushed from the console — it adds the user SID to local Administrators and registers `PrivGate-JIT-{id}` to remove them at expiry — even if the API is down. A JIT revoke from the console is applied immediately over the same socket.

## Runtime target

Both projects target **`net48`** (`.NET Framework 4.8`).

- Named pipes, job objects, Authenticode, and `schtasks.exe` are all available on the supported OS versions.
- `System.Text.Json` (8.x) is included as a NuGet dependency; the DLL ships alongside the exe.
- `CryptographicOperations.FixedTimeEquals` is not in .NET Framework; a manual constant-time
  comparison is used instead (see `TicketVerifier.cs`).
- `OperatingSystem.IsWindows()` (net5+) is replaced with `RuntimeInformation.IsOSPlatform(OSPlatform.Windows)`
  (available built-in from .NET Framework 4.7.1, which 4.8 satisfies).

## Install

Prefer **Devices** and download either the **MSI** or the **deployment script**. The file already contains this console’s address. The client registers the PC by hostname. Do not zip extra files onto the package.

See [docs/windows-vm.md](../docs/windows-vm.md).

## Ticket signing key

`TicketSigningKey` in `appsettings.json` is **not** the control plane's
`TICKET_SIGNING_KEY`. The installer writes
`HKDF-SHA256(TICKET_SIGNING_KEY, salt="privgate.ticket-key.v1", info="ticket:<DeviceId>")`,
so a key read off one endpoint cannot sign tickets any other endpoint will accept.
The checked-in `agent/appsettings.json` carries the derived value for `dev-lab-01`
under the development master key.

Consequences:

- Changing `DeviceId` in `appsettings.json` by hand breaks verification. Re-download
  the installer instead.
- Rotating `TICKET_SIGNING_KEY` on the control plane invalidates every endpoint;
  re-download the installer for each host.

The broker additionally rejects a ticket whose `dev` or `path` claim does not match
the device it is running on and the file it was asked to launch. `appsettings.json`
still holds secrets that a local admin can read — see the residual-risk section of
[docs/threat-model.md](../docs/threat-model.md).

## Build

```bat
cd agent
dotnet build -c Release
```

The SDK is cross-platform; `dotnet build` works on macOS/Linux but produces a Windows-only `.exe`.
Publish (produces all DLLs needed for xcopy deploy):

```bat
dotnet publish agent\PrivGate.Agent.csproj -c Release -f net48 -o dist\agent
dotnet publish agent\helper\PrivGate.Helper.csproj -c Release -f net48 -o dist\agent
```
