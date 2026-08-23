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

## Production configuration required

The control plane refuses to start in production (`NODE_ENV=production`) unless all
three secrets are set to operator-chosen values of at least 32 characters. The
development placeholders are rejected by name.

```bash
SESSION_SECRET=$(openssl rand -base64 48)        # admin session JWT
TICKET_SIGNING_KEY=$(openssl rand -base64 48)    # master key for elevation tickets
DEVICE_SECRET_KEY=$(openssl rand -base64 48)     # wraps per-device HMAC secrets at rest
```

Optional hardening:

| Variable | Purpose |
| --- | --- |
| `PRIVGATE_PUBLIC_ORIGIN` | Canonical origin used for OAuth redirects. Set this behind a proxy. |
| `PRIVGATE_AGENT_ORIGIN` | Canonical origin written into device installers when it is not “same host, agent port”. |
| `PRIVGATE_BIND` | Listen address. Default `0.0.0.0` (LAN). `127.0.0.1` for this host only. Legacy alias: `HOSTNAME`. |
| `PRIVGATE_WEB_PORT` | Management console TCP port. Default `3000`. Legacy alias: `PORT`. |
| `PRIVGATE_AGENT_PORT` | Broker `/api/agent` TCP port. Default `3001`. Set equal to the web port to share one listener. |
| `PRIVGATE_TRUSTED_HOSTS` | Comma-separated `host[:port]` allowlist for the `Host` header. |
| `PRIVGATE_TRUST_PROXY=1` | Also honour `X-Forwarded-Host` / `X-Forwarded-Proto`, still subject to the allowlist. |

`npm run dev` / packaged installs bind every interface so other computers can open the console. The agent port only accepts `/api/agent/*`. Windows packaged services add inbound firewall rules for both ports. Keep TLS termination in front of the console in production.

Rotating `TICKET_SIGNING_KEY` or `DEVICE_SECRET_KEY` invalidates every enrolled
endpoint. Re-download the installer from **Devices** for each host afterwards.

## Residual risk

**A JIT window is full local admin for N minutes.** Intentional; must be rare,
short, and audited.

**Endpoints hold their own ticket verification key.** `appsettings.json` in
`%ProgramFiles%\PrivGate` contains that device's HMAC secret and ticket key, both
readable by anyone who is already local admin or SYSTEM on that host. This is
inherent to symmetric ticket verification in a broker that must work offline.
Scope is limited three ways:

- The ticket key is `HKDF(TICKET_SIGNING_KEY, "ticket:<deviceId>")`, so a key
  lifted from one PC cannot sign tickets accepted by any other PC.
- The broker rejects tickets whose `dev` or `path` claim does not match what it is
  being asked to launch, and enforces hard bans before consulting the API.
- Someone who can read that file already has admin on that host, so the key grants
  no privilege they did not already hold locally.

Moving to asymmetric ticket signing (control plane holds the private key, endpoints
verify with a public key) would remove the forgery value of the file entirely and is
the recommended next step. It is a protocol change on both sides, not a config change.

**Admin-configured outbound requests are unrestricted.** The notification webhook
URL and SMTP host are reachable from the control plane, so a portal user with
`notifications.manage` can direct requests at internal addresses. This is a
privileged administrative feature; treat `notifications.manage` accordingly.

**SMTP TLS probing does not validate certificates.** `probeHost` connects with
`rejectUnauthorized: false` purely to report reachability from the Notifications
page. Delivery itself uses the configured `secure` setting.

**AD LDAPS bind does not pin the domain-controller certificate.** Internal DCs
often use a private CA. Treat `integrations.manage` as privileged: a bind
password is sent to the configured host.
