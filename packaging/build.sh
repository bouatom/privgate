#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../scripts/dotnet-env.sh
if [[ -f "$ROOT/scripts/dotnet-env.sh" ]]; then
  source "$ROOT/scripts/dotnet-env.sh"
fi

VERSION="${PRIVGATE_VERSION:-0.2.1}"
NODE_VERSION="${PRIVGATE_NODE_VERSION:-22.15.1}"
CACHE="$ROOT/.tools/cache"
STAGE="$ROOT/dist/stage"
OUT="$ROOT/dist/installers"
WINSW_URL="https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
# Comma-separated: windows,macos,linux or "all"
TARGETS="${PRIVGATE_TARGETS:-all}"

mkdir -p "$CACHE" "$STAGE" "$OUT"

log() { printf '\n==> %s\n' "$*"; }

want() {
  local t="$1"
  [[ "$TARGETS" == "all" || ",${TARGETS}," == *",${t},"* ]]
}

download() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    return 0
  fi
  log "Downloading $(basename "$dest")"
  curl -fL --retry 3 -o "$dest.partial" "$url"
  mv "$dest.partial" "$dest"
}

need() {
  command -v "$1" >/dev/null || {
    echo "missing tool: $1" >&2
    exit 1
  }
}

copy_if() {
  local src="$1" dest="$2"
  if [[ -f "$src" ]]; then
    cp "$src" "$dest"
  fi
}

assemble_app() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$ROOT/.next/standalone/." "$dest/"
  mkdir -p "$dest/.next"
  if [[ -d "$ROOT/.next/static" ]]; then
    cp -R "$ROOT/.next/static" "$dest/.next/static"
  fi
  if [[ -d "$ROOT/public" ]]; then
    cp -R "$ROOT/public" "$dest/public"
  fi
  cp "$ROOT/packaging/host.cjs" "$dest/host.cjs"
  mkdir -p "$dest/agent/dist"
  cp -a "$ROOT/agent/dist/." "$dest/agent/dist/"
  if [[ ! -f "$dest/agent/dist/PrivGate.Agent.exe" ]]; then
    echo "Console payload is missing the Windows client ($dest/agent/dist/PrivGate.Agent.exe)." >&2
    echo "A console that cannot enroll PCs must not ship. Run: bash scripts/smoke-agent-build.sh" >&2
    exit 1
  fi
  if [[ ! -f "$dest/agent/dist/PrivGate-Client.msi" ]]; then
    if [[ "${PRIVGATE_ALLOW_NO_CLIENT_MSI:-}" == "1" ]]; then
      echo "PRIVGATE_ALLOW_NO_CLIENT_MSI=1; payload has no Windows client MSI." >&2
    else
      echo "Console payload is missing the Windows client MSI ($dest/agent/dist/PrivGate-Client.msi)." >&2
      echo "Copy a CI-built MSI or install msitools (wixl). For experiments only: PRIVGATE_ALLOW_NO_CLIENT_MSI=1" >&2
      exit 1
    fi
  fi
  copy_if "$ROOT/packaging/listen.cjs" "$dest/listen.cjs"
  copy_if "$ROOT/packaging/listen-config.cjs" "$dest/listen-config.cjs"
  copy_if "$ROOT/packaging/graceful-shutdown.cjs" "$dest/graceful-shutdown.cjs"
  copy_if "$ROOT/packaging/write-env.cjs" "$dest/write-env.cjs"
  copy_if "$ROOT/packaging/startup-validation.cjs" "$dest/startup-validation.cjs"
  copy_if "$ROOT/packaging/artifact-check.cjs" "$dest/artifact-check.cjs"
  copy_if "$ROOT/packaging/health-check.cjs" "$dest/health-check.cjs"
  if [[ -f "$ROOT/scripts/update-server.sh" ]]; then
    cp "$ROOT/scripts/update-server.sh" "$dest/update-server.sh"
    chmod +x "$dest/update-server.sh"
  fi
}

smoke_packaged_host() {
  local dest="$1"
  log "Smoke packaged host.cjs"
  local data="$STAGE/smoke-data"
  local logf="$STAGE/smoke-host.log"
  local web=18223
  local agent=18224
  rm -rf "$data"
  mkdir -p "$data"
  (
    cd "$dest"
    PRIVGATE_DATA_DIR="$data" PRIVGATE_BIND=127.0.0.1 PRIVGATE_WEB_PORT="$web" PRIVGATE_AGENT_PORT="$agent" \
      node "$dest/host.cjs"
  ) >"$logf" 2>&1 &
  local pid=$!
  local i
  for i in $(seq 1 25); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "packaged host.cjs exited before it was ready:" >&2
      cat "$logf" >&2
      exit 1
    fi
    if grep -q "PrivGate console" "$logf"; then
      local code
      code="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${web}/setup" || true)"
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      if [[ "$code" != "200" ]]; then
        echo "packaged /setup returned HTTP ${code}" >&2
        cat "$logf" >&2
        exit 1
      fi
      return 0
    fi
    sleep 1
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  echo "packaged host.cjs did not log ready:" >&2
  cat "$logf" >&2
  exit 1
}

if [[ "${PRIVGATE_SKIP_APP_BUILD:-}" != "1" ]]; then
  log "Next.js production build"
  need node
  need npm
  (cd "$ROOT" && npm run build)

  if [[ "${PRIVGATE_SKIP_AGENT:-}" == "1" ]]; then
    log "Skipping Windows broker publish"
  else
    log "Windows broker publish"
    bash "$ROOT/scripts/smoke-agent-build.sh"
  fi
else
  log "Skipping app build (PRIVGATE_SKIP_APP_BUILD=1)"
fi

if [[ ! -f "$ROOT/agent/dist/PrivGate.Agent.exe" ]]; then
  echo "Windows client binaries are missing at agent/dist/PrivGate.Agent.exe" >&2
  echo "Cannot ship a console that cannot enroll PCs. Run: bash scripts/smoke-agent-build.sh" >&2
  exit 1
fi

CLIENT_MSI="$ROOT/agent/dist/PrivGate-Client.msi"
PREBUILT_CLIENT_MSI="${PRIVGATE_CLIENT_MSI:-$ROOT/dist/client-msi/PrivGate-Client.msi}"
if [[ -f "$PREBUILT_CLIENT_MSI" && "$PREBUILT_CLIENT_MSI" != "$CLIENT_MSI" ]]; then
  log "Using prebuilt Windows client MSI"
  cp "$PREBUILT_CLIENT_MSI" "$CLIENT_MSI"
fi
if [[ -f "$CLIENT_MSI" ]]; then
  log "Windows client MSI is ready"
elif command -v wixl >/dev/null; then
  log "Building Windows client MSI"
  node "$ROOT/packaging/windows/build-client-msi.cjs" \
    "$ROOT/agent/dist" \
    "$CLIENT_MSI" \
    "$VERSION"
elif [[ "${PRIVGATE_ALLOW_NO_CLIENT_MSI:-}" == "1" ]]; then
  echo "PRIVGATE_ALLOW_NO_CLIENT_MSI=1; shipping without client MSI" >&2
else
  echo "Windows client MSI is missing at agent/dist/PrivGate-Client.msi" >&2
  echo "Install msitools (wixl) or copy a CI-built MSI to dist/client-msi/PrivGate-Client.msi." >&2
  echo "For local experiments only: PRIVGATE_ALLOW_NO_CLIENT_MSI=1" >&2
  exit 1
fi
if [[ ! -f "$CLIENT_MSI" && "${PRIVGATE_ALLOW_NO_CLIENT_MSI:-}" != "1" ]]; then
  echo "Windows client MSI was not produced at $CLIENT_MSI" >&2
  exit 1
fi

if want windows; then
  log "Windows payload (Node + WinSW)"
  WIN_NODE_ZIP="$CACHE/node-v${NODE_VERSION}-win-x64.zip"
  download "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip" "$WIN_NODE_ZIP"
  download "$WINSW_URL" "$CACHE/WinSW-x64.exe"
  rm -rf "$STAGE/win"
  unzip -q -o "$WIN_NODE_ZIP" -d "$STAGE/win-node"
  assemble_app "$STAGE/win"
  smoke_packaged_host "$STAGE/win"
  cp "$STAGE/win-node/node-v${NODE_VERSION}-win-x64/node.exe" "$STAGE/win/node.exe"
  rm -rf "$STAGE/win-node"
  cp "$CACHE/WinSW-x64.exe" "$STAGE/win/PrivGateConsole.exe"
  cp "$ROOT/packaging/windows/privgate-console.xml" "$STAGE/win/PrivGateConsole.xml"
  copy_if "$ROOT/packaging/windows/service-ctl.cmd" "$STAGE/win/service-ctl.cmd"
  copy_if "$ROOT/packaging/windows/install-service.cmd" "$STAGE/win/install-service.cmd"
  copy_if "$ROOT/scripts/update-server.ps1" "$STAGE/win/update-server.ps1"

  if command -v makensis >/dev/null; then
    log "NSIS EXE"
    rm -rf "$STAGE/nsis"
    mkdir -p "$STAGE/nsis/payload"
    cp -R "$STAGE/win/." "$STAGE/nsis/payload/"
    cp "$ROOT/packaging/windows/privgate.nsi" "$STAGE/nsis/privgate.nsi"
    (cd "$STAGE/nsis" && makensis -V2 "-DPRIVGATE_VERSION=${VERSION}" privgate.nsi)
    mv "$STAGE/nsis/PrivGate-Console-Setup.exe" "$OUT/PrivGate-Console-${VERSION}-win-x64.exe"
  else
    echo "makensis not installed; skipping Windows EXE" >&2
  fi

  log "MSI"
  if command -v wixl >/dev/null; then
    node "$ROOT/packaging/windows/generate-wxs.cjs" "$STAGE/win" "$STAGE/privgate.wxs" "$VERSION"
    if wixl --arch x64 -o "$OUT/PrivGate-Console-${VERSION}-win-x64.msi" "$STAGE/privgate.wxs"; then
      echo "MSI written"
    else
      echo "wixl failed; EXE installer is still available" >&2
    fi
  else
    echo "wixl (msitools) not installed; skipping MSI" >&2
  fi
fi

if want macos; then
  if ! command -v pkgbuild >/dev/null; then
    echo "pkgbuild not installed; skipping macOS pkg" >&2
  else
    log "macOS pkg"
    ARCH="$(uname -m)"
    if [[ "$ARCH" == "arm64" ]]; then NODE_DARWIN="darwin-arm64"; else NODE_DARWIN="darwin-x64"; fi
    MAC_TAR="$CACHE/node-v${NODE_VERSION}-${NODE_DARWIN}.tar.gz"
    download "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_DARWIN}.tar.gz" "$MAC_TAR"
    rm -rf "$STAGE/mac" "$STAGE/mac-node"
    mkdir -p "$STAGE/mac"
    tar -xzf "$MAC_TAR" -C "$STAGE"
    mv "$STAGE/node-v${NODE_VERSION}-${NODE_DARWIN}" "$STAGE/mac-node"
    assemble_app "$STAGE/mac"
    mkdir -p "$STAGE/mac/bin"
    cp "$STAGE/mac-node/bin/node" "$STAGE/mac/bin/node"
    chmod +x "$STAGE/mac/bin/node"
    cp "$ROOT/packaging/macos/com.privgate.console.plist" "$STAGE/mac/com.privgate.console.plist"
    rm -rf "$STAGE/mac-node"
    SCRIPTS="$STAGE/mac-scripts"
    rm -rf "$SCRIPTS"
    mkdir -p "$SCRIPTS"
    cp "$ROOT/packaging/macos/scripts/postinstall" "$SCRIPTS/postinstall"
    copy_if "$ROOT/packaging/macos/scripts/preinstall" "$SCRIPTS/preinstall"
    chmod 755 "$SCRIPTS/postinstall"
    if [[ -f "$SCRIPTS/preinstall" ]]; then
      chmod 755 "$SCRIPTS/preinstall"
    fi
    pkgbuild \
      --root "$STAGE/mac" \
      --identifier com.privgate.console \
      --version "$VERSION" \
      --install-location /opt/privgate \
      --scripts "$SCRIPTS" \
      "$OUT/PrivGate-Console-${VERSION}-macos-${ARCH}.pkg"
  fi
fi

if want linux; then
  log "Linux payload + deb"
  LIN_TAR="$CACHE/node-v${NODE_VERSION}-linux-x64.tar.xz"
  download "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" "$LIN_TAR"
  rm -rf "$STAGE/linux"
  assemble_app "$STAGE/linux"
  mkdir -p "$STAGE/linux/bin"
  tar -xJf "$LIN_TAR" -C "$STAGE"
  cp "$STAGE/node-v${NODE_VERSION}-linux-x64/bin/node" "$STAGE/linux/bin/node"
  chmod +x "$STAGE/linux/bin/node"
  rm -rf "$STAGE/node-v${NODE_VERSION}-linux-x64"
  if [[ "${PRIVGATE_SKIP_TARBALL:-}" != "1" ]]; then
    tar -C "$STAGE/linux" -czf "$OUT/PrivGate-Console-${VERSION}-linux-x64.tar.gz" .
  fi

  DEB_ROOT="$STAGE/deb"
  rm -rf "$DEB_ROOT"
  mkdir -p "$DEB_ROOT/DEBIAN" "$DEB_ROOT/opt" "$DEB_ROOT/lib/systemd/system"
  cp -R "$STAGE/linux" "$DEB_ROOT/opt/privgate"
  cp "$ROOT/packaging/linux/privgate.service" "$DEB_ROOT/lib/systemd/system/privgate.service"
  cp "$ROOT/packaging/linux/control" "$DEB_ROOT/DEBIAN/control"
  cp "$ROOT/packaging/linux/postinst" "$DEB_ROOT/DEBIAN/postinst"
  cp "$ROOT/packaging/linux/prerm" "$DEB_ROOT/DEBIAN/prerm"
  cp "$ROOT/packaging/linux/postrm" "$DEB_ROOT/DEBIAN/postrm"
  copy_if "$ROOT/packaging/linux/preinst" "$DEB_ROOT/DEBIAN/preinst"
  copy_if "$ROOT/packaging/linux/config" "$DEB_ROOT/DEBIAN/config"
  copy_if "$ROOT/packaging/linux/templates" "$DEB_ROOT/DEBIAN/templates"
  chmod 755 "$DEB_ROOT/DEBIAN/postinst" "$DEB_ROOT/DEBIAN/prerm" "$DEB_ROOT/DEBIAN/postrm"
  if [[ -f "$DEB_ROOT/DEBIAN/preinst" ]]; then
    chmod 755 "$DEB_ROOT/DEBIAN/preinst"
  fi
  if [[ -f "$DEB_ROOT/DEBIAN/config" ]]; then
    chmod 755 "$DEB_ROOT/DEBIAN/config"
  fi
  INSTALLED_SIZE="$(du -sk "$DEB_ROOT/opt" | awk '{print $1}')"
  perl -i -pe "s/PLACEHOLDER/$INSTALLED_SIZE/" "$DEB_ROOT/DEBIAN/control"
  perl -i -pe "s/^Version: .*/Version: ${VERSION}/" "$DEB_ROOT/DEBIAN/control"

  if command -v dpkg-deb >/dev/null; then
    dpkg-deb --build "$DEB_ROOT" "$OUT/privgate-console_${VERSION}_amd64.deb"
  elif command -v docker >/dev/null; then
    docker run --rm -v "$STAGE:/stage" -v "$OUT:/out" debian:bookworm-slim \
      bash -lc "apt-get update -qq && apt-get install -y -qq dpkg-dev >/dev/null && dpkg-deb --build /stage/deb /out/privgate-console_${VERSION}_amd64.deb"
  else
    if [[ "${PRIVGATE_SKIP_TARBALL:-}" == "1" ]]; then
      echo "No dpkg-deb or docker; cannot build Linux .deb installer" >&2
      exit 1
    fi
    echo "No dpkg-deb or docker; Linux tar.gz is still in $OUT" >&2
  fi
fi

log "Artifacts"
ls -lh "$OUT"
