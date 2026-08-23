# Audit Logging

PrivGate maintains a comprehensive append-only audit log of all configuration changes, access events, and elevation decisions.

## Configuration Change Auditing

All configuration endpoints automatically log changes with before/after diffs:

### Active Directory Settings

- **Endpoint**: `PUT /api/directory/ad`
- **Action Logged**: `config.ad.update`
- **Details Tracked**:
  - `host` (old → new)
  - `port` (old → new)
  - `useTls` (old → new)
  - `bindDn` (old → new)
  - `baseDn` (old → new)
  - `userFilter` (old → new)
  - `password` (logged as `[redacted]` if changed)

**Example**:
```json
{
  "actor": "admin@example.com",
  "action": "config.ad.update",
  "target": "directory",
  "changes": {
    "host": { "old": "dc1.example.com", "new": "dc2.example.com" },
    "port": { "old": 636, "new": 389 }
  }
}
```

### Entra ID Setup

- **Endpoints**:
  - `POST /api/setup/entra/start` — logs `config.entra.setup.start` with method (pkce, native, az-token)
  - `GET /api/setup/entra/callback` — logs `config.entra.setup.complete` or `config.entra.callback.error`
  - `GET /api/setup/entra/device` — logs completion status

**Example**:
```json
{
  "actor": "admin@example.com",
  "action": "config.entra.setup.start",
  "target": "entra",
  "details": { "method": "pkce" }
}
```

## Sensitive Field Redaction

Passwords, secrets, and API keys are **never stored in plaintext** in the audit log:

- Field names containing `password`, `secret`, or `key` are logged as `[redacted]`
- Empty/null secrets log as `undefined`
- Rotation events log the timestamp but **not the secret itself**

**Example** (password change):
```json
{
  "actor": "admin@example.com",
  "action": "config.ad.update",
  "target": "directory",
  "changes": {
    "password": { "old": "[redacted]", "new": "[redacted]" }
  }
}
```

## Secret Rotation Auditing

Secret rotations are logged separately to provide clear traceability:

- **Action**: `secret.rotate`
- **Target**: The name of the secret rotated (e.g., `device-secret-key`, `signing-key`)
- **Details**: `rotatedAt` timestamp and optional reason

**Example**:
```json
{
  "actor": "system",
  "action": "secret.rotate",
  "target": "device-secret-key",
  "details": {
    "rotatedAt": "2026-08-23T14:30:00Z",
    "reason": "quarterly rotation"
  }
}
```

## Access Auditing

Sensitive operations are logged even when no configuration change occurs:

- **AD Connection Test**: `config.ad.test` logged with `{ ok: true/false, error?: string }`
- **Entra Setup Steps**: Each step in Entra provisioning is logged to track the flow

**Example** (failed connection test):
```json
{
  "actor": "admin@example.com",
  "action": "config.ad.test",
  "target": "dc1.example.com",
  "details": { "ok": false, "error": "Connection timed out" }
}
```

## Searching the Audit Log

Use the Audit UI at `/configuration/audit` to search by:

- **Action**: Filter by configuration type (e.g., `config.ad.update`, `config.entra.setup.start`)
- **Actor**: Search by user email or system component
- **Target**: Search by target resource (directory name, Entra ID, device, etc.)
- **Details**: Free-text search includes change diffs and error messages

**Example Searches**:

- `config.ad` — All AD configuration changes
- `admin@example.com` — All actions by this admin
- `secret.rotate` — All secret rotations
- `error` — All failed operations

## Compliance

This audit trail satisfies requirements from:

- **SOC 2 Type II**: Activity logging (CC6.1, CC7.2)
- **ISO 27001**: Appendix A.12.4.1 (Event logging and monitoring)
- **HIPAA**: Audit logs for protected health information access
- **PCI-DSS**: Activity logging for administrative actions

## Technical Details

Audit events are stored in the `audit_events` SQLite table:

```sql
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details TEXT NOT NULL  -- JSON
);
```

Events are immutable (append-only). The console UI provides read-only access via `/configuration/audit`.
