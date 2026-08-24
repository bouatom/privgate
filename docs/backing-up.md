---
layout: default
title: Backing up the management console
---

# Backing up the PrivGate management console

The console keeps **everything stateful in two files** inside the platform data
directory:

| Platform | Data directory | Files |
| --- | --- | --- |
| Windows | `%ProgramData%\PrivGate` | `privgate.db`, `console.env` |
| macOS | `/Library/Application Support/PrivGate` | `privgate.db`, `console.env` |
| Linux | `/var/lib/privgate` | `privgate.db`, `console.env` |

`privgate.db` is SQLite: users, roles, devices, allowlists, approvals, JIT
grants, audit history, notification settings. `console.env` holds generated
secrets (`SESSION_SECRET`, `TICKET_SIGNING_KEY`, `DEVICE_SECRET_KEY`) plus bind
and port settings.

## The key coupling — read this first

Device secrets in the database are **envelope-encrypted** under
`DEVICE_SECRET_KEY`, and elevation tickets are signed with `TICKET_SIGNING_KEY`
— both live **only** in `console.env`.

Consequences:

- Restoring `privgate.db` **without** the matching `console.env` gives you a
  database whose device secrets cannot be decrypted. Every enrolled PC fails
  HMAC verification and the **whole fleet re-enrolls**: new installers for every
  machine, lost device history.
- Restoring `console.env` without the matching database is harmless but useless
  (fresh database, same keys).
- Therefore: back up **both files together in the same archive**, and keep
  archives from the same era as the database you restore. A "database from
  Monday + env from last month" mix restores only if those keys have not been
  rotated since.

## What to capture

1. **`privgate.db`** — take a consistent copy:
   - *Online (preferred, no downtime):* `sqlite3 <data-dir>/privgate.db ".backup '/tmp/privgate.db'"`.
     This snapshots the DB including WAL content into one file.
   - *Stopped service:* stop the console first (`systemctl stop privgate`,
     `launchctl bootout system/com.privgate.console`, or Windows
     `service-ctl.cmd stop-all`), then copy `privgate.db`. After a clean stop
     there is no `-wal`/`-shm` leftover; if you copied a running DB anyway,
     discard it and take a `.backup` instead.
2. **`console.env`** — copy it into the **same archive** as the database (see
   the key coupling above).
3. Nothing under the install prefix (`C:\Program Files\PrivGate`,
   `/opt/privgate`) needs backing up; reinstallers reproduce it. Data
   directories survive uninstall by design (see
   [packaging/README.md](../packaging/README.md#management-console-installers)).

Helper scripts wrap this safely:

```bash
# macOS / Linux (root)
sudo packaging/backup.sh                      # stops console, tars db + env
sudo packaging/backup.sh --online             # sqlite3 .backup, no stop
sudo packaging/backup.sh --out /backups/pg-$(date +%F).tar.gz
```

```powershell
# Windows (elevated PowerShell)
.\packaging\backup.ps1                        # stops service, zips db + env
.\packaging\backup.ps1 -Out D:\Backups\pg.zip
```

Both print the archive path and refuse to overwrite. **Treat every archive as a
secret** — it contains `console.env`, i.e. the keys to the kingdom. Store it
with the same care as the console host itself (encrypted volume, restricted
share), never in the repo or a world-readable folder.

## Restore checklist

1. Stop the console on the target host.
2. Restore **both** `privgate.db` and `console.env` into the platform data
   directory (table above). On Linux fix ownership afterwards:
   `chown -R privgate:privgate /var/lib/privgate`.
3. Start the console and watch the health endpoint answer
   (`health-check.cjs --data-dir …`, or just open the web port).
4. Verify: log in with an existing account, confirm **Devices** shows hosts
   online within a minute or two (brokers reconnect their WebSocket), and spot
   one recent audit entry.
5. If devices stay offline after a restore, the usual cause is an env/database
   mismatch (keys rotated between the backups) — see the key coupling section;
   re-enrollment is then unavoidable.

## Rotation hint

- Nightly backup is plenty for most deployments; the console is rebuildable but
  the audit trail and enrollment are not.
- Keep at least the last 7 dailies and 4 weeklies; prune older archives.
- After **rotating `TICKET_SIGNING_KEY` / `DEVICE_SECRET_KEY`**, take a fresh
  backup immediately so env and database eras stay aligned.
- Test a restore quarterly on a scratch VM: an untested backup is a hope, not a
  plan.
