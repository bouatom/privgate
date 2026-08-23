---
layout: default
title: Documentation
---

# PrivGate documentation

PrivGate is self-hosted privilege elevation for **hybrid Active Directory and Entra ID**. People stay standard users. IT allowlists signed programs, approves a one-shot run, or opens a short just-in-time admin window — then the rights expire.

UAC stays on. Admin passwords are never stored on the PC.

**Product downloads** are on the [GitHub Releases](https://github.com/bouatom/privgate/releases/latest) page. The management console installer **is** the application.

## 1. Install the management console

| Platform | What to run |
| --- | --- |
| Windows 10 / 11 | `PrivGate-Console-*-win-x64.exe` (recommended) or `.msi` |
| macOS | `PrivGate-Console-*-macos-*.pkg` |
| Linux amd64 | `privgate-console_*_amd64.deb` or the `.tar.gz` |

After setup, open [http://127.0.0.1:3000](http://127.0.0.1:3000/). Lab login: **ada@contoso.test**.

The console binds **loopback** by default. Data and generated secrets:

- Windows: `%ProgramData%\PrivGate` (`console.env`)
- macOS: `/Library/Application Support/PrivGate`
- Linux: `/var/lib/privgate`

If a Windows MSI does not start the service, run `install-service.cmd` from `C:\Program Files\PrivGate`.

## 2. Sign in and roles

Portal operators are **local accounts** or **Entra SSO**. Master Admins assign predefined roles (Approver, Policy Admin, JIT Operator, Auditor) or custom roles with granular permissions.

Directory **Users** in the console are identities (JIT eligibility, disable). **Configuration → Users & permissions** is who can log into the console.

## 3. Enroll a Windows PC

1. **Devices** → enroll the hostname → **Download installer**.
2. On the PC, elevated PowerShell: `Install-PrivGate.ps1`. Needs .NET Framework 4.8 (inbox on current Windows 10/11).
3. Standard users elevate with:

   `PrivGate.Helper.exe --elevate <path>`

4. Unknown binaries create a **pending request**. Approvers allow once or deny. Policy admins add always-allow rules (hash **and** publisher). JIT operators open a 15–60 minute local-admin window that revokes on the PC even if the server is down.

Supported endpoints: Windows 7 SP1–11 and Server 2008 R2–2025. Lab notes: [Windows endpoint](windows-vm.md).

Do not run PrivGate and Microsoft Endpoint Privilege Management on the same machine.

## 4. Production

1. Set `AUTH_MODE=entra` in `console.env` and use Conditional Access MFA.
2. Replace secrets with values of at least 32 characters (`SESSION_SECRET`, `TICKET_SIGNING_KEY`, `DEVICE_SECRET_KEY`). The process will not start on placeholders.
3. Behind a reverse proxy, set `PRIVGATE_PUBLIC_ORIGIN` (and optionally `PRIVGATE_TRUSTED_HOSTS` / `PRIVGATE_TRUST_PROXY=1`).
4. After rotating ticket or device keys, **re-download the installer for every enrolled host**.

Operator security notes: [Threat model](threat-model.md).
