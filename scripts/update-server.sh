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
# Integrity (both checked BEFORE the running console is stopped):
#   --sha256 <hex>      expected SHA-256 of the .deb/.pkg file (payload
#                       directories cannot be pinned by one hash; ship a
#                       sha256sums.txt inside them instead)
#   sha256sums.txt      if this file sits next to the .deb/.pkg (or inside a
#                       --payload dir), every listed file is verified
#                       automatically; any mismatch aborts with nothing changed
#
# This script ships inside every console payload (/opt/privgate on POSIX), so
# it can also update an installed console from a later download.
set -Eeuo pipefail

PREFIX="${PRIVGATE_PREFIX:-/opt/privgate}"
NODE_BIN=""
PAYLOAD=""
DEB=""
PKG=""
DATA_DIR=""
HEALTH_URL=""
SKIP_BACKUP=0
EXPECTED_SHA256=""
STAMP="$(date +%Y%m%d-%H%M%S)"
OS_NAME="$(uname -s)"

# Logging contract mirrors scripts/update-server.ps1 (the console's status
# parser depends on it): FIRST output is "==> updater start ...", phases log
# via log(), any failure prints "error: ..." on its own line and exits nonzero.
log() { printf '==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
trap 'printf '"'"'error: update-server failed unexpectedly at line %s\n'"'"' "$LINENO" >&2' ERR

# Watchdog: the whole run may never exceed 10 minutes across all phases.
START_TS="$(date +%s)"
WATCHDOG_LAST="start"
watchdog() { # <phase-name>
  local phase="$1" elapsed
  elapsed=$(( $(date +%s) - START_TS ))
  if ((elapsed > 600)); then
    fail "update timed out after ${elapsed}s in phase $phase (last completed: $WATCHDOG_LAST)"
  fi
  WATCHDOG_LAST="$phase"
}

log "updater start pid=$$ bash=${BASH_VERSION:-?} at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "args: $*"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --payload) PAYLOAD="$2"; shift 2 ;;
    --deb) DEB="$2"; shift 2 ;;
    --pkg) PKG="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    --sha256) EXPECTED_SHA256="$2"; shift 2 ;;
    *) fail "unknown argument: $1 (see header of this script)" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "run with sudo (needs to stop/start system services)"
[[ -z "$PAYLOAD" ]] || [[ -d "$PAYLOAD" ]] || fail "--payload is not a directory: $PAYLOAD"
[[ -z "$DEB" || -f "$DEB" ]] || fail "--deb not found: $DEB"
[[ -z "$PKG" || -f "$PKG" ]] || fail "--pkg not found: $PKG"
SOURCES=$(( (${#PAYLOAD} > 0) + (${#DEB} > 0) + (${#PKG} > 0) ))
[[ "$SOURCES" -eq 1 ]] || fail "give exactly one of --payload, --deb or --pkg"

EXPECTED_SHA256="$(printf '%s' "$EXPECTED_SHA256" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
if [[ -n "$EXPECTED_SHA256" && ! "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  fail "--sha256 must be a 64-character hex SHA-256 digest"
fi
if [[ -n "$EXPECTED_SHA256" && -n "$PAYLOAD" ]]; then
  fail "--sha256 cannot pin a directory payload; put a sha256sums.txt inside the payload instead"
fi

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

# Keep the two newest ${PREFIX}.backup-* directories (the fresh one included);
# everything older is removed after the update has proven healthy.
prune_old_backups() {
  local current="$PREFIX.backup-$STAMP"
  local keep=("$current") d deleted=0
  while IFS= read -r d; do
    [[ -d "$d" ]] || continue
    [[ "$d" == "$current" ]] && continue
    if [[ ${#keep[@]} -lt 2 ]]; then
      keep+=("$d")
    else
      rm -rf "$d"
      deleted=$((deleted + 1))
    fi
  done < <(ls -1dt "$PREFIX".backup-* 2>/dev/null || true)
  if ((deleted > 0)); then
    log "Pruned $deleted old install backup(s), keeping the newest 2"
  fi
}

# --- payload integrity (D1): all checks run BEFORE stop/swap; fail closed ---

digest_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    return 1
  fi
}

check_digest() { # <file> <expected-hex> <label>
  local actual
  actual="$(digest_of "$1")" || fail "no SHA-256 tool found (need sha256sum or shasum) to verify $3"
  [[ "$actual" == "$2" ]] || fail "checksum mismatch for $3 ($1): expected $2, got $actual"
}

# Match "<hex>[ *]<name>" where <name> equals the basename of the target file.
assert_entry_for_file() { # <sums-file> <target-file>
  local sums="$1" target="$2" base hex
  base="$(basename "$target")"
  hex="$(awk -v b="$base" '
    /^[[:space:]]*(#|$)/ { next }
    { gsub(/\r$/, "") }
    {
      name = $2
      sub(/^\*/, "", name)
      if (name == b) { print tolower($1); exit }
    }' "$sums")"
  [[ -n "$hex" ]] || fail "$sums has no entry for '$base'"
  check_digest "$target" "$hex" "'$base' (per $sums)"
}

# Verify every entry of a sha256sums.txt shipped inside a --payload dir.
assert_payload_sums() { # <payload-dir>
  local sums="$1/sha256sums.txt"
  [[ -f "$sums" ]] || return 0
  log "Verifying sha256sums.txt inside the payload"
  local checked=0 line hex name target actual
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" || "$line" == \#* ]] && continue
    hex="$(printf '%s' "$line" | tr -d '\r' | awk '{print tolower($1)}')"
    name="$(printf '%s' "$line" | tr -d '\r' | awk '{ $1=""; sub(/^[[:space:]]*/, ""); print }' | sed 's/^\*//')"
    [[ "$hex" =~ ^[0-9a-f]{64}$ ]] || fail "malformed line in $sums: $line"
    [[ "$name" == "sha256sums.txt" ]] && continue
    target="$1/$name"
    [[ -f "$target" ]] || fail "sha256sums.txt lists a missing file: $name"
    actual="$(digest_of "$target")" || fail "no SHA-256 tool found (need sha256sum or shasum)"
    [[ "$actual" == "$hex" ]] || fail "checksum mismatch for '$name': expected $hex, got $actual"
    checked=$((checked + 1))
  done < "$sums"
  ((checked > 0)) || fail "$sums contains no usable entries"
}

verify_artifact_integrity() { # for --deb / --pkg file sources
  local f="" dir
  [[ -n "$DEB" ]] && f="$DEB"
  [[ -n "$PKG" ]] && f="$PKG"
  [[ -z "$f" ]] && return 0
  if [[ -n "$EXPECTED_SHA256" ]]; then
    log "Verifying checksum of $(basename "$f") against --sha256"
    check_digest "$f" "$EXPECTED_SHA256" "$(basename "$f")"
  fi
  dir="$(cd "$(dirname "$f")" && pwd)"
  if [[ -f "$dir/sha256sums.txt" ]]; then
    log "Verifying $(basename "$f") against $dir/sha256sums.txt"
    assert_entry_for_file "$dir/sha256sums.txt" "$f"
  fi
}

if [[ -n "$PAYLOAD" ]]; then
  watchdog "verify-payload"
  log "Verifying new payload"
  artifact_check "$PAYLOAD"
  assert_payload_sums "$PAYLOAD"

  watchdog "backup"
  backup_current

  watchdog "stop"
  stop_console

  watchdog "swap"
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

  watchdog "start"
  log "Starting console"
  start_console
else
  # Native package managers stop the service themselves (prerm/preinst,
  # pkg preinstall) and restart it after swapping files.
  watchdog "verify-artifact"
  verify_artifact_integrity
  if [[ -n "$DEB" ]]; then
    log "Verifying deb payload before install"
    # Prefer the system temp dir, but fall back to a scratch dir beside the
    # data directory when $TMPDIR is unwritable or full (read-only /tmp,
    # small tmpfs) instead of failing the whole update with a cryptic
    # "cannot write" error before anything has been touched.
    VERIFY_TMP="$(mktemp -d 2>/dev/null || true)"
    if [[ -z "$VERIFY_TMP" ]]; then
      mkdir -p "$(dirname "$DATA_DIR")"
      VERIFY_TMP="$(mktemp -d "$(dirname "$DATA_DIR")/.privgate-verify.XXXXXXXX")"
      log "system temp unwritable; verifying the deb under $VERIFY_TMP instead"
    fi
    if ! dpkg-deb -x "$DEB" "$VERIFY_TMP" ||
       ! artifact_check "$VERIFY_TMP/opt/privgate"; then
      rm -rf "$VERIFY_TMP"
      fail "new payload failed verification; nothing was changed"
    fi
    rm -rf "$VERIFY_TMP"
  fi
  watchdog "install"
  backup_current
  if [[ -n "$DEB" ]]; then
    log "Installing $DEB"
    dpkg -i "$DEB"
  else
    log "Installing $PKG"
    installer -pkg "$PKG" -target /
  fi
fi

watchdog "health"
log "Waiting for the management web port to answer"
health_check

watchdog "prune"
prune_old_backups

log "Update complete."
cat <<ROLLBACK
Rollback (only if needed):
  sudo mv ${PREFIX}.backup-${STAMP} ${PREFIX}.old
  sudo rm -rf '${PREFIX}'
  sudo mv ${PREFIX}.old ${PREFIX}
  then: $(restart_hint)
Data (${DATA_DIR}) was never touched by this update.
ROLLBACK
