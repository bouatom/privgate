#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=dotnet-env.sh
source "$ROOT/scripts/dotnet-env.sh"

if [[ ! -x "$DOTNET_ROOT/dotnet" ]]; then
  echo "Installing .NET SDK 8 into $DOTNET_ROOT (no sudo)…"
  mkdir -p "$ROOT/.tools"
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$ROOT/.tools/dotnet-install.sh"
  bash "$ROOT/.tools/dotnet-install.sh" --channel 8.0 --install-dir "$DOTNET_ROOT"
fi

echo "==> Publishing Windows Elevation Broker (net48)"
dotnet publish "$ROOT/agent/PrivGate.Agent.csproj" -c Release -f net48 -p:EnableWindowsTargeting=true -o "$ROOT/agent/dist"
dotnet publish "$ROOT/agent/helper/PrivGate.Helper.csproj" -c Release -f net48 -p:EnableWindowsTargeting=true -o "$ROOT/agent/dist"

test -f "$ROOT/agent/dist/PrivGate.Agent.exe"
test -f "$ROOT/agent/dist/PrivGate.Helper.exe"
echo "OK: $ROOT/agent/dist"
ls -lh "$ROOT/agent/dist"/*.exe
