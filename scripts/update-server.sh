#!/usr/bin/env bash
# PrivGate management-console updater (macOS / Linux). Run with sudo.
#
# One command, no manual process juggling:
#   verify the new artifact → stop the running console → swap files
#   → start again → health-check. Keeps a backup of the previous install for
#   rollback; zero downtime is NOT attempted.
#
# Usage:
#   update-server.sh --payload <dir>          # raw payload (tar.gz contents)
#   update-server.sh --deb <file.deb>         # verifies payload, dpkg -i
#   update-server.sh --pkg <file.pkg>         # macOS installer -pkg
# Common flags:
#   --data-dir <dir>    console.env location (default per-OS, like host.cjs)
#   --health-url <url>  override health check target
#   --skip-backup       do not keep ${PRIVGATE_PREFIX}.backup-<stamp>
#
# This script ships inside every console payload (/opt/privgate on POSIX), so
# it can also update an installed console from a later download.
set -euo pipefail

PREFIX="${PRIVGATE_PREFIX:-/opt/privgate}"
NODE_BIN=""
PAYLOAD=""
DEB=""
PKG=""
DATA_DIR=""
HEALTH_URL=""
SKIP_BACKUP=0
STAMP="$(date +%Y%m%d-%H%M%S)"
OS_NAME="$(uname -s)"

log() { printf '==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --payload) PAYLOAD="$2"; shift 2 ;;
    --deb) DEB="$2"; shift 2 ;;
    --pkg) PKG="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    *) fail "unknown argument: $1 (see header of this script)" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "run with sudo (needs to stop/start system services)"
[[ -z "$PAYLOAD" ]] || [[ -d "$PAYLOAD" ]] || fail "--payload is not a directory: $PAYLOAD"
[[ -z "$DEB" || -f "$DEB" ]] || fail "--deb not found: $DEB"
[[ -z "$PKG" || -f "$PKG" ]] || fail "--pkg not found: $PKG"
SOURCES=$(( (${#PAYLOAD} > 0) + (${#DEB} > 0) + (${#PKG} > 0) ))
[[ "$SOURCES" -eq 1 ]] || fail "give exactly one of --payload, --deb or --pkg"

if [[ -x "$PREFIX/bin/node" ]]; then NODE_BIN="$PREFIX/bin/node"
elif command -v node >/dev/null; then NODE_BIN="$(command -v node)"
else fail "no node runtime found (looked in $PREFIX/bin and PATH)"; fi

artifact_check() { "$NODE_BIN" "$1/artifact-check.cjs" "$1"; }

default_data_dir() {
  case "$OS_NAME" in
    Darwin) echo "/Library/Application Support/PrivGate" ;;
    *) echo "/var/lib/privgate" ;;
  esac
}
DATA_DIR="${DATA_DIR:-$(default_data_dir)}"

stop_console() {
  log "Stopping the running console (SIGTERM drains sockets and closes SQLite)"
  if [[ "$OS_NAME" == "Darwin" ]]; then
    launchctl bootout system/com.privgate.console 2>/dev/null || true
  else
    systemctl stop privgate.service 2>/dev/null || true
  fi
  local pids i=0
  pids="$(pgrep -f "$PREFIX/bin/node $PREFIX/host.cjs" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill -TERM $pids 2>/dev/null || true
    while [[ $i -lt 8 ]]; do
      pgrep -f "$PREFIX/bin/node $PREFIX/host.cjs" >/dev/null 2>&1 || break
      sleep 1; i=$((i + 1))
    done
    pgrep -f "$PREFIX/bin/node $PREFIX/host.cjs" >/dev/null 2>&1 && kill -KILL $pids 2>/dev/null || true
  fi
}

start_console() {
  if [[ "$OS_NAME" == "Darwin" ]]; then
    [[ -f /Library/LaunchDaemons/com.privgate.console.plist ]] || return 0
    launchctl bootstrap system /Library/LaunchDaemons/com.privgate.console.plist 2>/dev/null ||
      launchctl kickstart -k system/com.privgate.console
  else
    systemctl start privgate.service
  fi
}

restart_hint() {
  if [[ "$OS_NAME" == "Darwin" ]]; then
    echo "launchctl bootstrap system /Library/LaunchDaemons/com.privgate.console.plist"
  else
    echo "systemctl restart privgate.service"
  fi
}

health_check() {
  local check_args=()
  [[ -n "$HEALTH_URL" ]] && check_args+=(--url "$HEALTH_URL")
  [[ -n "$DATA_DIR" ]] && check_args+=(--data-dir "$DATA_DIR")
  "$NODE_BIN" "$PREFIX/health-check.cjs" "${check_args[@]+"${check_args[@]}"}"
}

backup_current() {
  [[ "$SKIP_BACKUP" -eq 1 || ! -d "$PREFIX" ]] && return 0
  log "Backing up current install to $PREFIX.backup-$STAMP"
  cp -a "$PREFIX" "$PREFIX.backup-$STAMP"
}

if [[ -n "$PAYLOAD" ]]; then
  log "Verifying new payload"
  artifact_check "$PAYLOAD"
  backup_current
  stop_console

  log "Swapping files in $PREFIX"
  mkdir -p "$PREFIX"
  find "$PREFIX" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -R "$PAYLOAD/." "$PREFIX/"
  chmod +x "$PREFIX/bin/node" 2>/dev/null || true
  chmod +x "$PREFIX/update-server.sh" 2>/dev/null || true
  NODE_BIN="$PREFIX/bin/node"
  if getent passwd privgate >/dev/null 2>&1; then
    chown -R privgate:privgate "$PREFIX"
    chown -R privgate:privgate /var/log/privgate 2>/dev/null || true
  fi
  "$NODE_BIN" "$PREFIX/write-env.cjs" --dir "$DATA_DIR" --preserve

  log "Starting console"
  start_console
else
  # Native package managers stop the service themselves (prerm/preinst,
  # pkg preinstall) and restart it after swapping files.
  if [[ -n "$DEB" ]]; then
    log "Verifying deb payload before install"
    VERIFY_TMP="$(mktemp -d)"
    dpkg-deb -x "$DEB" "$VERIFY_TMP"
    artifact_check "$VERIFY_TMP/opt/privgate"
    rm -rf "$VERIFY_TMP"
  fi
  backup_current
  if [[ -n "$DEB" ]]; then
    log "Installing $DEB"
    dpkg -i "$DEB"
  else
    log "Installing $PKG"
    installer -pkg "$PKG" -target /
  fi
fi

log "Waiting for the management web port to answer"
health_check

log "Update complete."
cat <<ROLLBACK
Rollback (only if needed):
  sudo mv ${PREFIX}.backup-${STAMP} ${PREFIX}.old
  sudo rm -rf '${PREFIX}'
  sudo mv ${PREFIX}.old ${PREFIX}
  then: $(restart_hint)
Data (${DATA_DIR}) was never touched by this update.
ROLLBACK
