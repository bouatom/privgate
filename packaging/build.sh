#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../scripts/dotnet-env.sh
if [[ -f "$ROOT/scripts/dotnet-env.sh" ]]; then
  source "$ROOT/scripts/dotnet-env.sh"
fi

VERSION="${PRIVGATE_VERSION:-0.1.0}"
NODE_VERSION="${PRIVGATE_NODE_VERSION:-22.15.1}"
CACHE="$ROOT/.tools/cache"
STAGE="$ROOT/dist/stage"
OUT="$ROOT/dist/installers"
WINSW_URL="https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"

mkdir -p "$CACHE" "$STAGE" "$OUT"

log() { printf '\n==> %s\n' "$*"; }

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
}

if [[ "${PRIVGATE_SKIP_APP_BUILD:-}" != "1" ]]; then
  log "Next.js production build"
  need node
  need npm
  (cd "$ROOT" && npm run build)

  log "Windows broker publish"
  if [[ -x "${DOTNET_ROOT:-}/dotnet" ]]; then
    bash "$ROOT/scripts/smoke-agent-build.sh"
  else
    echo "dotnet SDK not in .tools; skip agent publish (device zip will be source-only)"
  fi
else
  log "Skipping app build (PRIVGATE_SKIP_APP_BUILD=1)"
fi

# --- Windows ---
log "Windows payload (Node + WinSW)"
WIN_NODE_ZIP="$CACHE/node-v${NODE_VERSION}-win-x64.zip"
download "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip" "$WIN_NODE_ZIP"
download "$WINSW_URL" "$CACHE/WinSW-x64.exe"
rm -rf "$STAGE/win"
unzip -q -o "$WIN_NODE_ZIP" -d "$STAGE/win-node"
assemble_app "$STAGE/win"
cp "$STAGE/win-node/node-v${NODE_VERSION}-win-x64/node.exe" "$STAGE/win/node.exe"
rm -rf "$STAGE/win-node"
cp "$CACHE/WinSW-x64.exe" "$STAGE/win/PrivGateConsole.exe"
cp "$ROOT/packaging/windows/privgate-console.xml" "$STAGE/win/PrivGateConsole.xml"
printf '%s\n' '@echo off' 'cd /d "%~dp0"' 'PrivGateConsole.exe install' 'PrivGateConsole.exe start' 'echo Open http://127.0.0.1:3000/' > "$STAGE/win/install-service.cmd"

log "NSIS EXE"
need makensis
rm -rf "$STAGE/nsis"
mkdir -p "$STAGE/nsis/payload"
cp -R "$STAGE/win/." "$STAGE/nsis/payload/"
cp "$ROOT/packaging/windows/privgate.nsi" "$STAGE/nsis/privgate.nsi"
(cd "$STAGE/nsis" && makensis -V2 privgate.nsi)
mv "$STAGE/nsis/PrivGate-Console-Setup.exe" "$OUT/PrivGate-Console-${VERSION}-win-x64.exe"

log "MSI"
if command -v wixl >/dev/null; then
  node "$ROOT/packaging/windows/generate-wxs.cjs" "$STAGE/win" "$STAGE/privgate.wxs"
  if wixl --arch x64 -o "$OUT/PrivGate-Console-${VERSION}-win-x64.msi" "$STAGE/privgate.wxs"; then
    echo "MSI written"
  else
    echo "wixl failed; EXE installer is still available" >&2
  fi
else
  echo "wixl (msitools) not installed; skipping MSI" >&2
fi

# --- macOS ---
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
chmod 755 "$SCRIPTS/postinstall"
pkgbuild \
  --root "$STAGE/mac" \
  --identifier com.privgate.console \
  --version "$VERSION" \
  --install-location /opt/privgate \
  --scripts "$SCRIPTS" \
  "$OUT/PrivGate-Console-${VERSION}-macos-${ARCH}.pkg"

# --- Linux amd64 ---
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
tar -C "$STAGE/linux" -czf "$OUT/PrivGate-Console-${VERSION}-linux-x64.tar.gz" .

DEB_ROOT="$STAGE/deb"
rm -rf "$DEB_ROOT"
mkdir -p "$DEB_ROOT/DEBIAN" "$DEB_ROOT/opt" "$DEB_ROOT/lib/systemd/system"
cp -R "$STAGE/linux" "$DEB_ROOT/opt/privgate"
cp "$ROOT/packaging/linux/privgate.service" "$DEB_ROOT/lib/systemd/system/privgate.service"
cp "$ROOT/packaging/linux/control" "$DEB_ROOT/DEBIAN/control"
cp "$ROOT/packaging/linux/postinst" "$DEB_ROOT/DEBIAN/postinst"
cp "$ROOT/packaging/linux/prerm" "$DEB_ROOT/DEBIAN/prerm"
chmod 755 "$DEB_ROOT/DEBIAN/postinst" "$DEB_ROOT/DEBIAN/prerm"
INSTALLED_SIZE="$(du -sk "$DEB_ROOT/opt" | awk '{print $1}')"
perl -i -pe "s/PLACEHOLDER/$INSTALLED_SIZE/" "$DEB_ROOT/DEBIAN/control"

if command -v dpkg-deb >/dev/null; then
  dpkg-deb --build "$DEB_ROOT" "$OUT/privgate-console_${VERSION}_amd64.deb"
elif command -v docker >/dev/null; then
  docker run --rm -v "$STAGE:/stage" -v "$OUT:/out" debian:bookworm-slim \
    bash -lc "apt-get update -qq && apt-get install -y -qq dpkg-dev >/dev/null && dpkg-deb --build /stage/deb /out/privgate-console_${VERSION}_amd64.deb"
else
  echo "No dpkg-deb or docker; Linux tar.gz is still in $OUT" >&2
fi

log "Artifacts"
ls -lh "$OUT"
