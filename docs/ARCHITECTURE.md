# PrivGate Architecture

## Overview

PrivGate is a self-hosted privilege elevation control plane for Windows endpoints. It consists of a **management console** (Node.js/Next.js) and a **Windows agent** (C#/.NET) that runs as a SYSTEM service on enrolled endpoints.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PrivGate Management Console                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │  Policies   │  │  Devices   │  │ Elevations │  │   JIT    │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘      │
│         │            │            │            │                    │
└────────────────────────┬────────────────────────────────────────────┘
                         │ HTTPS 3000 (REST) / WebSocket 3001 (agent)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Windows Endpoint (×1000+)                        │
│  ┌─────────────────┐    Named Pipe (\\.\pipe\PrivGateElevation)   │
│  │  Broker         │◄────────────────────────────────────────────┤  │
│  │  (SYSTEM)       │  │  PrivGate.Helper (user context)          │  │
│  │  (SYSTEM)       │  │                                            │
│  │  Named Pipe     │◄─┤  PrivGate.Helper (user ctx)              │
│  │  \\.\pipe\      │  │                                            │
│  │  PrivGate       │  │                                            │
         ▼                                       │
         │                                       │
┌─────────────────────────────────────────────────────────────────────┐
│                    Active Directory / Entra ID                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Management Console (`src/app`, `src/lib`)

**Technology Stack:**
- **Runtime:** Node.js 22 (LTS), Next.js 15 (App Router)
- **Database:** SQLite with WAL mode (`better-sqlite3`)
- **Authentication:** JWT (HS256), scrypt password hashing, 8h default session
- **Real-time:** WebSocket (`ws` library) on port 3001
- **Authentication:** Local (scrypt) + Entra ID (OIDC PKCE)

**Key Modules:**
| Module | Purpose |
|--------|---------|
| `src/lib/auth.ts` | JWT session management, password hashing (scrypt) |
| `src/lib/portal.ts` | User/role management, RBAC |
| `src/lib/policy.ts` | Policy evaluation engine (hash/publisher/name/args/bind) |
| `src/lib/notify.ts` | Email/webhook notifications |
| `src/lib/realtime/bus.ts` | WebSocket pub/sub, SSE, replay buffer |
| `src/lib/self-update-*.ts` | Self-update orchestration |

### 2. Windows Agent (`agent/`)

**Technology Stack:**
- **Language:** C# (.NET Framework 4.8)
- **Service:** Windows Service (WinSW) running as SYSTEM
- **IPC:** Named pipe (`\\.\pipe\PrivGateElevation`)
- **Communication:** WebSocket to console (port 3001), HMAC auth

**Components:**
| Component | Responsibility |
|-----------|----------------|
| `BrokerHost` | Service entry point, lifecycle, DI container |
| `BrokerHost.Handle` | Named pipe server, request dispatch |
| `ElevationPrompt` | UAC prompt, consent UI |
| `ElevationClient` | HTTP/WebSocket to console |
| `ApiClient` | HMAC-signed RPC to console |
| `RealtimeChannel` | WebSocket with exponential backoff |
| `JitWatchdog` | JIT grant expiry monitoring |
| `UpdateManager` | Self-update via MSI/EXE |

### 3. Helper CLI (`agent/helper/`)

**Purpose:** User-context elevation CLI invoked by user or tray app

**Modes:**
- `--elevate <path>` — Request elevation for executable
- `--json` — Machine-readable JSON output (for automation)
- Default: Human-readable output (`Elevated: <path> (pid N)`)

---

## Data Flow: Elevation Request

```
User clicks "Request Elevation" in tray
        │
        ▼
PrivGate.Helper.exe --elevate "C:\Path\App.exe"
        │
        ▼
Named Pipe (\\.\pipe\PrivGateElevation) ──► Broker (SYSTEM)
        │
        ▼
Broker builds EvaluateSubject (user, device, file hash, publisher)
        │
        ▼
WebSocket (port 3001) ──► Console API /api/agent/evaluate
        │
        ▼
Console: evaluateElevation() → Policy match → Decision
        │
        ▼
Decision: allow / deny / pending
        │
        ▼
If allow: generate HMAC-signed ticket (device-specific)
        │
        ▼
WebSocket push to agent ──► Broker validates ticket → launches as child
        │
        ▼
Child process runs as child of Broker (job object, no UAC prompt)
        │
        ▼
Broker monitors child, reports launch result via WebSocket
```

---

## Data Model

### Core Entities

| Entity | Key Fields |
|--------|------------|
| `PortalUser` | `id`, `email`, `displayName`, `kind` (local/sso), `disabled`, `roleIds[]`, `permissions[]` |
| `PortalRole` | `id`, `name`, `permissions[]`, `system` (builtin) |
| `Policy` | `id`, `name`, `effect` (allow/deny/require_approval), `fileHash`, `publisher`, `fileName`, `argumentPattern`, `bindType`, `bindId`, `childProcesses`, `highRiskException` |
| `Device` | `id`, `hostname`, `joinType`, `secretEnc`, `agentVersion`, `lastSeenAt` |
| `ElevationRequest` | `id`, `userId`, `deviceId`, `filePath`, `fileHash`, `publisher`, `arguments`, `status`, `riskLevel`, `requestedAt`, `decidedAt`, `decidedBy` |
| `JitGrant` | `id`, `userId`, `deviceId`, `durationMinutes`, `reason`, `startsAt`, `expiresAt`, `status`, `memberIds[]` |
| `AuditEvent` | `id`, `at`, `actor`, `action`, `target`, `details` (JSON) |

### Policy Evaluation Order

1. **Hard-banned binaries** (PowerShell, cmd, etc.) → always deny unless high-risk exception
2. **Explicit deny policies** → deny
3. **Explicit allow policies** → allow (with child process policy)
5. **Require-approval policies** → pending
6. **Default** → pending (requires admin approval)

---

## Security Architecture

### Authentication
- **Console:** JWT (HS256), scrypt-hashed passwords, 8h default TTL (configurable via `PRIVGATE_SESSION_TTL`)
- **Agent ↔ Console:** HMAC-SHA256 (device secret + timestamp), WebSocket with HMAC auth
- **Passwords:** scrypt (N=16384, r=8, p=1), 16-byte salt, 32-byte key

### Elevation Tickets
- HMAC-SHA256 signed by `TICKET_SIGNING_KEY` (per-device derived)
- Contains: `requestId`, `filePath`, `fileHash`, `expiresAt`, `decision`
- Verified by broker before launch

### JIT Access
- Granted via `POST /api/jit` (duration 15-60 min)
- Broker adds user SID to local `Administrators` group
- Scheduled task (`PrivGate-JIT-<id>`) revokes at expiry
- Revocable instantly via `POST /api/jit/{id}/revoke`

---

## Self-Update Architecture

```
Console (v0.3.1) ──checks──► GitHub Releases
                          │
                          ▼
                  Downloads .msi (Windows)
                          │
                          ▼
         ┌────────────────┴────────────────┐
         │   self-update-apply.ts          │
         │  1. Download MSI + sha256sums   │
         │  2. Verify SHA-256              │
         │  3. Spawn update-server.ps1     │
         │       (detached, file-based log)│
         └────────────────┬────────────────┘
                          │
                          ▼
              ┌───────────┴───────────────┐
              │ update-server.ps1         │
              │ 1. Stop service           │
              │ 2. Backup current .next   │
              │ 3. MSI install (silent)   │
              │ 4. Start service          │
              │ 5. Health check           │
              └───────────┬───────────────┘
                          │
                          ▼
               Success: version updated
               Failure: rollback to backup
```

---

## Data Storage

| Data | Location | Format |
|------|----------|--------|
| Console DB | `%ProgramData%\PrivGate\privgate.db` (Windows) / `/var/lib/privgate/privgate.db` (Linux) | SQLite (WAL) |
| Console Config | `%ProgramData%\PrivGate\console.env` | `KEY=VALUE` |
| Agent Config | `C:\Program Files\PrivGate\appsettings.json` | JSON |
| Agent Logs | `%ProgramData%\PrivGate\logs\broker.log` | JSON Lines |
| Backup | User-managed | Copy `privgate.db` + `console.env` |

---

## Scaling Considerations

| Layer | Current Limit | Scaling Path |
|-------|--------------|--------------|
| Console (Node.js) | ~500 concurrent WS | Cluster mode + Redis pub/sub |
| SQLite | ~10k devices | Migrate to PostgreSQL |
| WebSocket | 1 connection/device | Horizontal scaling with Redis pub/sub |
| SQLite WAL | Concurrent reads | Read replicas |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | JWT session management |
| `src/lib/portal.ts` | User/role CRUD |
| `src/lib/policy.ts` | Policy evaluation engine |
| `src/lib/notify.ts` | Email/webhook notifications |
| `src/lib/realtime/bus.ts` | WebSocket pub/sub, SSE, replay |
| `src/lib/self-update-apply.ts` | Self-update orchestration |
| `src/lib/realtime/bus.ts` | WebSocket pub/sub, replay buffer |
| `src/lib/self-update-apply.ts` | Self-update orchestration |
| `agent/BrokerHost.cs` | Service entry, DI container |
| `agent/BrokerHost.Handle.cs` | Named pipe server, request dispatch |
| `agent/RealtimeChannel.cs` | WebSocket client, HMAC auth |
| `agent/ApiClient.cs` | HMAC-signed RPC to console |
| `agent/helper/Program.cs` | CLI entry point, human/JSON output |
| `src/app/api/...` | Next.js App Router API routes |

---

## Extending PrivGate

### Adding a New Permission
1. Add to `ALL_PERMISSIONS` in `src/lib/permissions.ts`
2. Add to relevant `PREDEFINED_ROLES` in `portal.ts`
2. Run `npm test` (permission matrix tests in `permissions.test.ts`)

### Adding a New Policy Field
1. Update `Policy` type in `src/lib/policy.ts`
2. Update `assertAllowPolicyInput` validation
3. Update `policy.ts` evaluation logic
3. Add migration if DB schema changes

### Adding a New API Route
1. Create `src/app/api/<resource>/[id]/route.ts`
2. Use `requireAdmin("permission")` for auth
3. Add audit log via `appendAudit()`
3. Return `NextResponse.json()`

---

## Monitoring & Observability

| Metric | Source |
|--------|--------|
| Health | `GET /api/healthz` → `{ok, db, agentsOnline, version}` |
| Audit | `GET /api/audit` (paginated, filterable) |
| Audit Export | `GET /api/audit/export` (CSV) |
| Audit Events | `GET /api/events` (SSE stream) |
| Device Status | `GET /api/devices` (includes `lastSeenAt`) |

---

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) — Production deployment, HA, scaling
- [Developer Guide](DEVELOPER_GUIDE.md) — Code structure, testing, contributing
- [Security](SECURITY.md) — Threat model, hardening, compliance
- [API Reference](API_REFERENCE.md) — Complete REST/WebSocket API
- [Troubleshooting](TROUBLESHOOTING.md) — Common issues & fixes