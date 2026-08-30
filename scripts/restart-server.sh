#!/usr/bin/env bash
# PrivGate console server-settings restarter (macOS / Linux). Run with sudo,
# or as the service user via the detached handoff from the console.
#
# Applies a new bind/web-port/agent-port to console.env, restarts the console,
# and health-checks on the NEW port. If the console does not come back healthy,
# the previous console.env is restored and the console restarted again.
#
# Logging contract mirrors scripts/restart-server.ps1:
#   * FIRST output is "==> restart-server start ..."
#   * phases log via log(), any failure prints "error: ..." and exits nonzero
#     AFTER rolling the env file back.
#   * success ends with the exact line "==> server settings applied."
#
# Usage:
#   restart-server.sh --bind 0.0.0.0 --web-port 3000 --agent-port 3001
# Common flags:
#   --data-dir <dir>    console.env location (default per-OS, like host.cjs)
#   --health-url <url>  override health check target
set -Eeuo pipefail

PREFIX="${PRIVGATE_PREFIX:-/opt/privgate}"
NODE_BIN=""
BIND=""
WEB_PORT=""
AGENT_PORT=""
DATA_DIR=""
HEALTH_URL=""
STAMP="$(date +%Y%m%d-%H%M%S)"
OS_NAME="$(uname -s)"
BACKUP_FILE=""
ENV_RESTORED=0

log() { printf '==> [%ss] %s\n' "$(( $(date +%s) - START_TS ))" "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
trap 'printf '"'"'error: restart-server failed unexpectedly at line %s\n'"'"' "$LINENO" >&2; exit 1' ERR

START_TS="$(date +%s)"
WATCHDOG_LAST="start"
watchdog() { # <phase-name>
  local phase="$1" elapsed
  elapsed=$(( $(date +%s) - START_TS ))
  if ((elapsed > 600)); then
    fail "apply timed out after ${elapsed}s in phase $phase (last completed: $WATCHDOG_LAST)"
  fi
  WATCHDOG_LAST="$phase"
}

log "restart-server start pid=$$ bash=${BASH_VERSION:-?} at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "args: $*"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bind) BIND="$2"; shift 2 ;;
    --web-port) WEB_PORT="$2"; shift 2 ;;
    --agent-port) AGENT_PORT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    *) fail "unknown argument: $1 (see header of this script)" ;;
  esac
done

BIND="$(printf '%s' "$BIND" | xargs)"
WEB_PORT="$(printf '%s' "$WEB_PORT" | xargs)"
AGENT_PORT="$(printf '%s' "$AGENT_PORT" | xargs)"
[[ -n "$BIND" && ! "$BIND" =~ [[:space:]] ]] || fail "invalid --bind address: $BIND"
[[ "$WEB_PORT" =~ ^[0-9]+$ && "$WEB_PORT" -ge 1 && "$WEB_PORT" -le 65535 ]] || fail "--web-port must be an integer between 1 and 65535: $WEB_PORT"
[[ "$AGENT_PORT" =~ ^[0-9]+$ && "$AGENT_PORT" -ge 1 && "$AGENT_PORT" -le 65535 ]] || fail "--agent-port must be an integer between 1 and 65535: $AGENT_PORT"

default_data_dir() {
  case "$OS_NAME" in
    Darwin) echo "/Library/Application Support/PrivGate" ;;
    *) echo "/var/lib/privgate" ;;
  esac
}
DATA_DIR="${DATA_DIR:-$(default_data_dir)}"

if [[ -x "$PREFIX/bin/node" ]]; then NODE_BIN="$PREFIX/bin/node"
elif command -v node >/dev/null; then NODE_BIN="$(command -v node)"
else fail "no node runtime found (looked in $PREFIX/bin and PATH)"; fi

ENV_FILE="$DATA_DIR/console.env"
BACKUP_FILE="$DATA_DIR/server-settings/console.env.bak-$STAMP"
mkdir -p "$DATA_DIR/server-settings" 2>/dev/null || true

if [[ -f "$ENV_FILE" ]]; then
  log "Backing up console.env to $BACKUP_FILE"
  cp -a "$ENV_FILE" "$BACKUP_FILE"
fi

watchdog "write-env"
log "Writing the three listen keys (secrets untouched)"
if [[ -f "$PREFIX/write-env.cjs" ]]; then
  "$NODE_BIN" "$PREFIX/write-env.cjs" --dir "$DATA_DIR" --bind "$BIND" --web-port "$WEB_PORT" --agent-port "$AGENT_PORT"
elif [[ -f "$(dirname "$0")/write-env.cjs" ]]; then
  "$NODE_BIN" "$(dirname "$0")/write-env.cjs" --dir "$DATA_DIR" --bind "$BIND" --web-port "$WEB_PORT" --agent-port "$AGENT_PORT"
elif [[ -f "$(dirname "$0")/../packaging/write-env.cjs" ]]; then
  "$NODE_BIN" "$(dirname "$0")/../packaging/write-env.cjs" --dir "$DATA_DIR" --bind "$BIND" --web-port "$WEB_PORT" --agent-port "$AGENT_PORT"
else
  fail "write-env.cjs not found next to the payload or in the repo"
fi

restart_hint() {
  if [[ "$OS_NAME" == "Darwin" ]]; then
    echo "launchctl bootstrap system /Library/LaunchDaemons/com.privgate.console.plist"
  else
    echo "systemctl restart privgate.service"
  fi
}

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

is_packaged() {
  [[ -f "$PREFIX/host.cjs" ]] && { [[ "$OS_NAME" == "Darwin" && -f /Library/LaunchDaemons/com.privgate.console.plist ]] || { systemctl list-unit-files privgate.service >/dev/null 2>&1 && [[ "$(systemctl is-enabled privgate.service 2>/dev/null || true)" == "enabled" ]]; }; }
}

if ! is_packaged; then
  log "dev mode: no console service to restart — the next console start uses the new settings"
  log "server settings applied."
  echo "console.env at $ENV_FILE was updated. Restart the console process to apply." >&2
  exit 0
fi

health_check() {
  local check_args=()
  [[ -n "$HEALTH_URL" ]] && check_args+=(--url "$HEALTH_URL")
  [[ -n "$DATA_DIR" ]] && check_args+=(--data-dir "$DATA_DIR")
  "$NODE_BIN" "$PREFIX/health-check.cjs" "${check_args[@]+"${check_args[@]}"}"
}

watchdog "stop"
stop_console

watchdog "start"
log "Starting console"
start_console

watchdog "health"
log "Waiting for the management web port to answer (new settings)"
if ! health_check; then
  log "WARNING: restoring previous console.env after failure"
  if [[ -f "$BACKUP_FILE" ]]; then
    cp -a "$BACKUP_FILE" "$ENV_FILE"
    start_console
    log "WARNING: previous settings restored; console restarting on the old port"
  else
    log "WARNING: could not restore console.env — manual rollback required"
  fi
  fail "console did not become healthy after applying the server settings"
fi

ENV_RESTORED=0
log "server settings applied."
cat <<ROLLBACK
Rollback (only if needed):
  cp -a '$BACKUP_FILE' '$ENV_FILE'
  then: $(restart_hint)
ROLLBACK
exit 0