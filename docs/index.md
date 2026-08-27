# PrivGate Documentation

**Zero-trust privilege elevation for Active Directory, Entra ID, and hybrid Windows fleets.**

> **Keep every user standard. Elevate only what you approve.**

PrivGate is a self-hosted privilege elevation control plane for Windows endpoints. It lets standard users request admin rights on-demand — approved instantly by policy or by an admin — without ever granting standing local administrator rights.

---

## Why PrivGate?

**The Problem:** Every Windows admin knows the dilemma — users need admin rights occasionally, but granting standing local admin creates massive attack surface. Ransomware, malware, and insider threats all exploit standing admin rights.

**Traditional solutions fail:**
- ❌ Local admin for everyone → massive attack surface
- ❌ Shared admin passwords → stolen, phished, leaked in scripts
- ❌ UAC prompts with shared passwords → passwords leak, no audit trail
- ❌ Vendor EPM tools → six-figure licenses, cloud-only, no hybrid AD/Entra support

**PrivGate's approach:**
- ✅ **Zero standing privilege** — users run as standard users 100% of the time
- ✅ **Cryptographic identity** — elevations authorized by SHA-256 hash + Authenticode publisher
- ✅ **Just-in-Time (JIT) admin** — 15-60 minute local admin windows, auto-revoked
- ✅ **Hybrid identity** — Active Directory, Entra ID, or both simultaneously
- ✅ **Self-hosted, no per-seat cost** — you own the infrastructure

---

## Quick Start

### 1. Install the Console
| Platform | Installer | Service |
|----------|-----------|-----------|
| Windows 10/11, Server 2019+ | `.exe` or `.msi` | Windows service (SYSTEM) |
| macOS 12+ | `.pkg` | launchd |
| Linux (Debian/Ubuntu/RHEL) | `.deb` | systemd |

After install, open `http://<console-host>:3000/` — first visit launches the **setup wizard** (create Master Admin).

### 2. Connect Identity Sources
- **Entra ID** — Configuration → Integrations → Connect Entra ID
- **Active Directory** — Configuration → Integrations → Connect AD (LDAPS)
- Both can be active simultaneously (hybrid)

### 3. Enroll Windows Endpoints
```powershell
# Silent MSI install (Intune/SCCM/NinjaOne)
msiexec /i PrivGate-Client.msi /qn /norestart

# Or deployment script
.\Install-PrivGate.ps1
```

The agent registers by hostname and connects to the console via WebSocket (port 3001).

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Standard User** | Runs as standard user 100% of the time |
| **Elevation Request** | User requests admin for a specific binary |
| **Policy** | SHA-256 + Authenticode publisher rule (allow / require-approval / deny) |
| **JIT Access** | Time-boxed local admin (15-60 min), auto-revoked |
| **JIT Grant** | Signed ticket pushed via WebSocket, enforced by local scheduled task |

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System architecture, data flow, components |
| [Deployment Guide](DEPLOYMENT.md) | Production deployment, HA, scaling |
| [Developer Guide](DEVELOPER_GUIDE.md) | Contributing, code structure, testing |
| [Security](SECURITY.md) | Threat model, hardening, compliance |
| [API Reference](API_REFERENCE.md) | REST API, WebSocket, Webhooks |
| [Troubleshooting](TROUBLESHOOTING.md) | Common issues & solutions |
| [API Reference (OpenAPI)](openapi.yaml) | Machine-readable OpenAPI spec |
| [Threat Model](threat-model.md) | STRIDE analysis, mitigations |
| [Windows VM Setup](windows-vm.md) | Test environment setup |
| [Backup & Restore](backing-up.md) | Database & config backup procedures |
| [Updating](updating.md) | Console & agent update procedures |

---

## Quick Links

| Task | Link |
|------|------|
| Install Console | [Deployment Guide](DEPLOYMENT.md#1-install-the-console) |
| Enroll Windows PC | [Enrollment Guide](DEPLOYMENT.md#3-enroll-windows-endpoints) |
| Create Policies | [Policy Management](API_REFERENCE.md#policies) |
| Configure JIT | [JIT Access](API_REFERENCE.md#jit-access) |
| Connect Entra ID | [Entra Integration](DEPLOYMENT.md#connect-entra-id) |
| Connect Active Directory | [AD Integration](DEPLOYMENT.md#connect-active-directory) |
| Backup Strategy | [Backup & Restore](backing-up.md) |
| Update Console | [Updating](updating.md) |

---

## Quick Reference

| Port | Purpose |
|------|---------|
| 3000 | Management console (HTTPS recommended) |
| 3001 | Agent WebSocket broker (TLS) |

| Environment Variable | Purpose |
|----------------------|---------|
| `PRIVGATE_BIND` | Bind address (default: `0.0.0.0`) |
| `PRIVGATE_WEB_PORT` | Console port (default: 3000) |
| `PRIVGATE_AGENT_PORT` | Broker port (default: 3001) |
| `PRIVGATE_SESSION_TTL` | Session TTL seconds (default: 28800) |
| `PRIVGATE_DATA_DIR` | Data directory (default: OS-specific) |
| `AUTH_MODE` | `local` or `entra` |

---

## Quick Links

- [GitHub Repository](https://github.com/bouatom/privgate)
- [Releases](https://github.com/bouatom/privgate/releases)
- [Issues](https://github.com/bouatom/privgate/issues)
- [Discussions](https://github.com/bouatom/privgate/discussions)
- [Security Policy](SECURITY.md)

---

*PrivGate — Zero-trust privilege elevation for Windows. Keep every user standard. Elevate only what you approve.*