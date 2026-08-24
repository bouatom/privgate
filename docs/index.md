---
layout: default
title: Documentation
---

# PrivGate documentation

PrivGate is self-hosted privilege elevation for **Active Directory, Entra ID, or hybrid**. People stay standard users. IT allowlists signed programs, approves a one-shot run, or opens a short just-in-time admin window — then the rights expire.

UAC stays on. Admin passwords are never stored on the PC.

**Product downloads** are on the [GitHub Releases](https://github.com/bouatom/privgate/releases/latest) page. The management console installer **is** the application.

## 1. Install the management console

| Platform | What to run |
| --- | --- |
| Windows 10 / 11 | `PrivGate-Console-*-win-x64.exe` (recommended) or `.msi` |
| macOS | `PrivGate-Console-*-macos-*.pkg` |
| Linux amd64 | `privgate-console_*_amd64.deb` |

After setup, open [http://127.0.0.1:3000](http://127.0.0.1:3000/) on the console host, or `http://<console-host>:3000/` from another computer. The first visit is a **setup wizard** that creates the local Master Admin. Connect Entra ID and/or on-premises Active Directory later under Configuration → Integrations — they are independent. Sign in with Entra appears on `/login` only after Entra is connected. There is **no demo login**.

The process binds **all interfaces** by default (`PRIVGATE_BIND=0.0.0.0`): management UI on **3000**, Windows brokers on **3001**. Data and generated secrets:

- Windows: `%ProgramData%\PrivGate` (`console.env`)
- macOS: `/Library/Application Support/PrivGate`
- Linux: `/var/lib/privgate`

If a Windows MSI does not start the service, run `install-service.cmd` from `C:\Program Files\PrivGate`.

To upgrade, install the newer EXE, MSI, pkg, or deb over the existing copy. Do not uninstall first. Data and `console.env` stay; the service restarts. The console drains gracefully on SIGTERM (agent WebSockets get a close frame, SQLite is checkpointed), so no manual process juggling is needed. Details: [updating the management console](updating.md) and [packaging/README.md](../packaging/README.md#upgrade-the-management-console).

## 2. Sign in and roles

Portal operators are **local accounts** or **Entra SSO**. Master Admins assign predefined roles (Approver, Policy Admin, JIT Operator, Auditor) or custom roles with granular permissions.

Directory **Users** in the console are identities (JIT eligibility, disable). **Configuration → Users & permissions** is who can log into the console.

## 3. Enroll a Windows PC

1. **Devices** → pick **MSI** or **deployment script** → download that one file from the same console you will enroll against.
2. On the PC, run the MSI (`msiexec /i PrivGate-Client.msi /qn /norestart` for Intune / SCCM / NinjaOne) or elevated PowerShell: `Install-PrivGate.ps1`. Needs .NET Framework 4.8 (inbox on current Windows 10/11). The client registers the hostname. RMM notes: [packaging/README.md](../packaging/README.md#windows-client-msi-intune--sccm--ninjaone).
3. Standard users elevate with:

   `PrivGate.Helper.exe --elevate <path>`

4. Unknown binaries create a **pending request**. Approvers allow once or deny. Policy admins add always-allow rules (hash **and** publisher). JIT operators open a 15–60 minute local-admin window that revokes on the PC even if the server is down.

Supported endpoints: Windows 7 SP1–11 and Server 2008 R2–2025. Lab notes: [Windows endpoint](windows-vm.md).

Do not run PrivGate and Microsoft Endpoint Privilege Management on the same machine.

## 4. Production

1. Set `AUTH_MODE=entra` in `console.env` (or leave `local` and use the Master Admin created at install) and use Conditional Access MFA when Entra is on.
2. Secrets are generated at install (`SESSION_SECRET`, `TICKET_SIGNING_KEY`, `DEVICE_SECRET_KEY`). The process will not start on placeholders.
3. Behind a reverse proxy, set `PRIVGATE_PUBLIC_ORIGIN` (and optionally `PRIVGATE_AGENT_ORIGIN`, `PRIVGATE_TRUSTED_HOSTS` / `PRIVGATE_TRUST_PROXY=1`).
4. After rotating ticket or device keys, **re-download the installer for every enrolled host**.

To restrict the console to this machine only, set `PRIVGATE_BIND=127.0.0.1` in `console.env` and restart.

Operator security notes: [Threat model](threat-model.md).
