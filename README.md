# PrivGate

**Keep every user standard. Elevate only what you approve.**

PrivGate is self-hosted privilege elevation for organizations on **Active Directory, Entra ID, or both (hybrid)**. People work as standard users. When a signed installer or a one-off tool needs admin rights, IT allowlists it, approves a single run, or opens a short just-in-time window — then the rights go away.

UAC stays on. Admin passwords never live on the PC. There is no kernel hook and no `runas /savecred`.

**[Documentation](docs/index.md)** — install the console, enroll Windows PCs, production settings.

## Why teams use it

- **One console** for AD-joined, Entra-joined, and hybrid-joined Windows PCs — not a tenant-wide local-admin blast.
- **Allowlists that actually match the binary** (SHA-256 and Authenticode publisher, not the filename).
- **One-shot approvals** for unknown software, with a clear risk level in the queue.
- **JIT admin** (15–60 minutes) that expires on the device even if the server is unreachable.
- **Granular portal roles** so approvers, policy authors, and JIT operators are not all Master Admins.
- **Works where Intune Endpoint Privilege Management is not licensed** or not covering domain-joined machines. Do not run both agents on the same PC.

## Install the management console

Download the installer for your host OS from the **[latest GitHub Release](https://github.com/bouatom/privgate/releases/latest)**. That package **is** the product.

| Platform | Installer |
| --- | --- |
| Windows 10 / 11 | `.exe` (recommended) or `.msi` |
| macOS | `.pkg` |
| Linux (amd64) | `.deb` |

After install, open the console from this machine at [http://127.0.0.1:3000](http://127.0.0.1:3000/) or from another computer at `http://<console-host>:3000/`. The first visit is a **setup wizard** that creates the local Master Admin. Connect Entra ID and/or on-premises Active Directory later under Configuration → Integrations — they are independent. SSO appears on the login page only after Entra is connected. Download the Windows **MSI** or **deployment script** from **Devices**; each PC registers itself by hostname. There are no demo logins.

The process listens on **all interfaces** by default: management UI on port **3000**, Windows brokers on port **3001**. Data and generated secrets land under ProgramData (Windows), `/Library/Application Support/PrivGate` (macOS), or `/var/lib/privgate` (Linux). There are no demo logins.

Windows MSI: if the service does not start, run `install-service.cmd` from `C:\Program Files\PrivGate`.

## Enroll a Windows PC

1. In the console: **Devices** → pick **MSI** or **deployment script** → download that one file from the same console you will enroll against.
2. On the PC, run the MSI (`msiexec /i PrivGate-Client.msi /qn /norestart` for Intune / SCCM / NinjaOne) or the script from an elevated PowerShell. Requires .NET Framework 4.8 (inbox on current Windows 10/11). The client registers the computer’s hostname.
3. Standard users elevate with `PrivGate.Helper.exe --elevate <path>`.
4. Approvers handle pending requests; policy admins maintain always-allow rules; JIT operators open time-boxed local-admin windows.

Supported endpoints: Windows 7 SP1 through 11, and Server 2008 R2 through 2025. See [docs/windows-vm.md](docs/windows-vm.md).

## Production

Turn on Entra sign-in (`AUTH_MODE=entra`), Conditional Access MFA, and keep the generated secrets. After rotating ticket or device keys, re-download the installer for every enrolled host.

Operator notes: [Documentation](docs/index.md) · [Threat model](docs/threat-model.md).
