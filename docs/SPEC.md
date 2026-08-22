# Specification: PrivGate

**State:** approved  
**Date:** 2026-08-22

## Deliverables

- Admin web console (pending requests, always-allow policies, users, JIT, audit)
- Control-plane API with Entra ID login (development mock when tenant env is unset)
- Directory users as AD SID + Entra OID identities
- Windows Elevation Broker (SYSTEM) + standard-user helper
- Signed elevation/JIT tickets; append-only audit

## Acceptance criteria

1. A standard user cannot elevate an unsigned/unlisted binary; UAC is not bypassed or disabled.
2. An always-allow policy matches **file SHA-256 + Authenticode publisher** (filename alone is never enough).
3. Hard-banned shells (`cmd.exe`, `powershell.exe`, `pwsh.exe`, `wscript.exe`, `mshta.exe`, `reg.exe`) cannot be always-allow.
4. Unknown binaries create a **pending request**; an Approver can approve (one-shot, short TTL) or deny.
5. An Approver can open a JIT window (15–60 minutes, reason required, one active per user+device) and force-revoke.
6. JIT revoke is scheduled **on the device at grant time** so expiry still happens if the API is unreachable.
7. Every evaluate / approve / deny / JIT grant / revoke is in the audit log.
8. Users cannot call approve/deny/policy APIs. Agents cannot call admin APIs.
9. A PolicyAdmin can connect Entra by signing in as Global Administrator; the control plane creates the Graph application and syncs users/groups.
10. Pending elevation requests carry a risk level (`low|medium|high|critical`) with human-readable reasons.
11. Admins can enroll a device, download a Windows installer zip, and review events per host.
12. First login opens a dashboard of pending/approved/denied metrics. Configuration holds Integrations (Entra + AD), Notifications, and Audit.

## Interfaces

See [openapi.yaml](openapi.yaml). Agent authenticate with device HMAC. Admins authenticate with a session cookie (Entra or development login).

## Constraints

- Hybrid AD + Entra identities
- No admin passwords stored on endpoints
- Child processes deny-by-default for allowlisted apps
- This Mac develops the control plane; the broker is built/run on a Windows 11 VM (`docs/windows-vm.md`)
- SQLite for local/dev (swap `PRIVGATE_DATABASE_URL` to Postgres later). Docker Compose optional.

## Units of work

1. Control plane + login + directory users  
2. Policy store (allow / deny / require-approval)  
3. Admin dashboard  
4. Windows broker allowlist launch  
5. Approval → one-shot ticket  
6. JIT + local watchdog revoke  
