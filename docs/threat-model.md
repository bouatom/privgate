# Threat model (STRIDE)

Trust boundaries: **user session → SYSTEM broker → HTTPS API → Entra**.

```text
[User] --named pipe--> [Broker SYSTEM] --HMAC HTTPS--> [API]
[Admin browser] --OIDC/session--> [Dashboard] --> [API] --> [SQLite audit]
```

## Top threats and day-1 mitigations

| Rank | Threat | STRIDE | Mitigation |
| --- | --- | --- | --- |
| 1 | Filename-only allowlist (binary swap) | Tampering / EoP | SHA-256 **and** Authenticode publisher required |
| 2 | Always-allow `cmd.exe` / PowerShell | EoP | Hard bans; cannot be effect=allow |
| 3 | JIT user left in Administrators | EoP | Local revoke task written at grant; watchdog; admin force-revoke |
| 4 | Forged approval | Spoofing | Approve APIs require admin session; agents cannot call them |
| 5 | Stolen device identity | Spoofing | Per-device HMAC secret; timestamp skew limit; secret shown once |
| 6 | Policy tampering on disk | Tampering | Tickets HMAC-signed with server key; broker rejects bad/expired tickets |
| 7 | Child process from elevated installer | EoP | Child processes deny-by-default in allow tickets |
| 8 | Audit deletion after abuse | Repudiation | Append-only `audit_events` (no update/delete API) |
| 9 | Replay of elevate ticket | Spoofing | Ticket TTL + nonce stored as consumed |
| 10 | Compromised admin session | EoP | HttpOnly cookie, short TTL, SameSite=Lax; Entra MFA via Conditional Access in production |

## Explicitly refused

UAC bypasses, credential harvesting, disabling UAC, storing admin passwords, `runas /savecred`, kernel exploits, intercepting the stock UAC dialog.

## Residual risk

A JIT window **is** full local admin for N minutes. That is intentional and must be rare, short, and audited.
