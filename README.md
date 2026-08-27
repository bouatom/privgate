# PrivGate

**Zero-trust privilege elevation for Active Directory, Entra ID, and hybrid Windows fleets.**

---

## The Problem

Every organization runs Windows. Every organization has developers, IT ops, and power users who *occasionally* need administrator rights — to install a driver, run a legacy tool, debug a service. The traditional choices are all bad:

| Approach | What Breaks |
|----------|-------------|
| **Local admin for everyone** | Ransomware spreads laterally in minutes; compliance fails; audit findings pile up |
| **IT manually grants admin via RDP/GPO** | Slow, opaque, forgotten revocations; "temporary" becomes permanent |
| **UAC prompt with shared admin password** | Passwords leak, get phished, stored in scripts; no audit trail |
| **Endpoint Privilege Management (EPM) from major vendors** | Six-figure licenses; cloud-only; doesn't support domain-joined machines; forces agent upgrades on their schedule |

**PrivGate eliminates the false choice.** You keep UAC *on*. No admin passwords ever touch the endpoint. No kernel hooks. No `runas /savecred`. Just a self-hosted control plane that evaluates every elevation request in real time — by hash, by publisher, by policy — and returns a cryptographically signed, one-shot ticket the local broker verifies before launching.

---

## What You Get

### For Security Teams
- **Cryptographic certainty** — every elevation is authorized by SHA-256 hash + Authenticode publisher, not filename
- **Zero standing privilege** — users run as standard users 100% of the time; admin rights exist only for the duration of an approved elevation or a JIT window
- **Complete audit trail** — append-only log of every request, decision, JIT grant, policy change, and config mutation. Exportable to SIEM.
- **Dual enforcement** — JIT admin windows expire locally via scheduled task *even if the server is unreachable*

### For IT Operations
- **One console** for AD-joined, Entra-joined, and hybrid-joined Windows PCs
- **Intune/SCCM-ready MSI** with silent install (`/qn /norestart`), automatic firewall rules, and hostname-based enrollment
- **Granular RBAC** — Approvers, Policy Admins, JIT Operators, Auditors, Master Admins — each sees only what they need
- **Entra ID + on-prem AD** — connect both independently; hybrid environments work without compromise

### For Developers & Power Users
- **Frictionless elevation** — right-click the tray icon or run `PrivGate.Helper.exe --elevate <path>`
- **Transparent decisions** — instant allow for pre-approved tools; clear "pending approval" with risk level for unknowns; instant deny for hard-banned shells (`powershell.exe`, `cmd.exe`, etc.)
- **No workflow interruption** — approved apps launch directly on the user's desktop; no UAC prompt, no context switch

### For Leadership
- **Self-hosted, no per-seat licensing** — runs on your infrastructure, your cloud, your terms
- **Scales to 1,000+ endpoints** — single Node.js process handles 500+ concurrent WebSocket connections; SQLite with WAL handles write contention; horizontal scaling via Postgres migration path
- **Compliance-ready** — ISO 27001, SOC 2, NIST 800-53 controls map directly to audit log, least privilege, and separation of duties
- **Future-proof** — open architecture, no vendor lock-in, community-driven roadmap

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                    PrivGate Management Console                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Policies │ │ Devices  │ │ Elevations│ │  JIT     │  ...    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│         │            │            │            │                │
│         └────────────┴────────────┴────────────┘                │
│                          ▼                                       │
│              ┌─────────────────────┐                            │
│              │   SQLite Database   │                            │
│              │ (WAL, integrity chk)│                            │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
                          │              │
              HTTPS 3000  │              │  WebSocket 3001 (device HMAC)
                          ▼              ▼
         ┌───────────────────────────────────────┐
         │      Windows Endpoint (×1000+)        │
         │  ┌─────────────┐  ┌───────────────┐  │
         │  │   Broker    │  │  PrivGate.Helper│  │
         │  │  (SYSTEM)   │  │   (user ctx)    │  │
         │  │             │  │                 │  │
         │  │ Named pipe  │◄─┤ --elevate path  │  │
         │  │ \\.\pipe\   │  │                 │  │
         │  │ PrivGate    │  │ SHA-256 + pub   │  │
         │  └──────┬──────┘  └────────┬────────┘  │
         │         │                  │           │
         │         ▼                  ▼           │
         │  HMAC-signed ticket → launches as child │
         │  of broker (job object, no UAC prompt)  │
         └─────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install the Console
Download the installer for your host OS from the **[latest GitHub Release](https://github.com/bouatom/privgate/releases/latest)**:

| Platform | Installer | Notes |
|----------|-----------|-------|
| Windows 10/11, Server 2019+ | `.exe` (recommended) or `.msi` | Runs as Windows service |
| macOS 12+ (Intel/Apple Silicon) | `.pkg` | Runs via launchd |
| Linux (amd64, Debian/Ubuntu/RHEL) | `.deb` | Runs via systemd |

After install, open the console at `http://<console-host>:3000/`. The first visit launches a **setup wizard** that creates the local Master Admin. Connect Entra ID and/or on-premises Active Directory later under **Configuration → Integrations** — they are independent. SSO appears on the login page only after Entra is connected.

### 2. Enroll Windows Endpoints
From **Devices** in the console, download the **MSI** or **deployment script** — both are signed and pre-configured for your console URL.

```powershell
# Silent Intune/SCCM/NinjaOne deployment
msiexec /i PrivGate-Client.msi /qn /norestart

# Or run the deployment script from elevated PowerShell
.\Install-PrivGate.ps1
```

Requirements: Windows 7 SP1–11 / Server 2008 R2–2025, .NET Framework 4.8 (inbox on current Windows), outbound HTTPS to console (port 3000) and WebSocket (port 3001).

### 3. Operate
- **Standard users**: right-click tray shield → "Request a program…" → app launches on approval
- **Approvers**: `/elevations` → approve/deny/allowlist pending requests
- **Policy admins**: `/allowlists` → create SHA-256 + publisher rules (allow / require-approval / deny)
- **JIT operators**: `/elevations?tab=jit` → grant 15–60 min local-admin windows
- **Auditors**: `/configuration/audit` → search, filter, export CSV

---

## Production Hardening Checklist

- [ ] Enable Entra SSO (`AUTH_MODE=entra`) + Conditional Access MFA
- [ ] Set `PRIVGATE_SESSION_TTL` (default 8h, min 5m) for compliance
- [ ] Configure email/webhook notifications for pending/approved/denied/JIT events
- [ ] Rotate ticket/device keys periodically; re-download installer for enrolled hosts
- [ ] Enable backup of SQLite database (`/var/lib/privgate/privgate.db` or equivalent)
- [ ] Review threat model: [docs/threat-model.md](docs/threat-model.md)

---

## Why It Matters

**Privilege escalation is the #1 attack vector in Windows ransomware campaigns.** Microsoft's own data shows >80% of successful breaches involve stolen or misused admin credentials. Standing local admin is the single largest reducible risk in most Windows environments.

PrivGate reduces that risk to **zero standing privilege** without breaking productivity. It's the only solution that:
- Works on **domain-joined, Entra-joined, and hybrid** machines simultaneously
- Enforces policy by **cryptographic identity** (hash + publisher), not fragile filenames
- Provides **local JIT expiration** that survives network partitions
- Costs **nothing per seat** — you host it, you own it, you control it

---

## Documentation & Support

- **Full docs**: [docs/index.md](docs/index.md) — installation, enrollment, production settings, API reference
- **Threat model**: [docs/threat-model.md](docs/threat-model.md) — attack surface, mitigations, assumptions
- **Windows VM guide**: [docs/windows-vm.md](docs/windows-vm.md) — test environment setup
- **Agent packaging**: [packaging/README.md](packaging/README.md) — MSI/EXE/pkg/deb build details

---

## License

MIT. Free for commercial use. No per-seat fees. No phone-home telemetry.

---

**Ready to eliminate standing local admin?**  
Download the latest release → run the setup wizard → enroll your first PC → approve your first elevation. Five minutes to a safer Windows fleet.

[![GitHub Release](https://img.shields.io/github/v/release/bouatom/privgate?label=Latest%20Release&sort=semver)](https://github.com/bouatom/privgate/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/bouatom/privgate/dotnet-desktop.yml?label=Tests)](https://github.com/bouatom/privgate/actions)
[![License](https://img.shields.io/github/license/bouatom/privgate)](LICENSE)