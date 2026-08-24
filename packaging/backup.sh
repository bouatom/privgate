#!/usr/bin/env bash
# PrivGate console backup (macOS / Linux): privgate.db + console.env into one
# archive. Both files must travel together — device secrets in the DB are
# envelope-encrypted under keys that live only in console.env. See
# docs/backing-up.md.
#
# Usage (root):
#   packaging/backup.sh [--data-dir DIR] [--out FILE] [--online]
#     --online   use `sqlite3 .backup` so the console keeps running
#                (default: stop the console, copy, start again)
set -euo pipefail

DATA_DIR=""
OUT=""
ONLINE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --online) ONLINE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

OS_NAME="$(uname -s)"
[[ -n "$DATA_DIR" ]] || case "$OS_NAME" in
  Darwin) DATA_DIR="/Library/Application Support/PrivGate" ;;
  *) DATA_DIR="/var/lib/privgate" ;;
esac
DB="$DATA_DIR/privgate.db"
ENV_FILE="$DATA_DIR/console.env"
[[ -f "$DB" ]] || { echo "error: no database at $DB" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "error: no console.env at $ENV_FILE (back up both files together)" >&2; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT:-$DATA_DIR/privgate-backup-$STAMP.tar.gz}"
[[ ! -e "$OUT" ]] || { echo "error: refusing to overwrite $OUT" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo "error: run with sudo (reads console.env and controls the service)" >&2; exit 1; }

stop_console() {
  if [[ "$OS_NAME" == "Darwin" ]]; then
    launchctl bootout system/com.privgate.console 2>/dev/null || true
  else
    systemctl stop privgate.service 2>/dev/null || true
  fi
}

start_console() {
  if [[ "$OS_NAME" == "Darwin" ]]; then
    [[ -f /Library/LaunchDaemons/com.privgate.console.plist ]] && \
      launchctl bootstrap system /Library/LaunchDaemons/com.privgate.console.plist 2>/dev/null ||
      launchctl kickstart -k system/com.privgate.console 2>/dev/null || true
  else
    systemctl start privgate.service 2>/dev/null || true
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/data"

if [[ "$ONLINE" -eq 1 ]]; then
  command -v sqlite3 >/dev/null 2>&1 || { echo "error: --online needs the sqlite3 CLI" >&2; exit 1; }
  sqlite3 "$DB" ".backup '$WORK/data/privgate.db'"
else
  stop_console
  cp "$DB" "$WORK/data/privgate.db"
  for extra in "$DB-wal" "$DB-shm"; do
    # Leftovers only after an unclean stop; include them if present.
    [[ -f "$extra" ]] && cp "$extra" "$WORK/data/" || true
  done
  start_console
fi
cp "$ENV_FILE" "$WORK/data/console.env"

tar -czf "$OUT" -C "$WORK" data
chmod 600 "$OUT"
echo "Backup written: $OUT"
echo "WARNING: the archive contains console.env (signing + device encryption keys). Store it like a secret."
