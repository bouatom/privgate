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

# The .exe.config must be present and contain the Unsafe binding redirect.
# Without it the CLR throws TypeInitializationException at startup on net48
# because System.Memory 4.5.5 references Unsafe 4.0.4.1 while the NuGet DLL
# is 6.0.0.0 and there is no redirect to reconcile the two.
test -f "$ROOT/agent/dist/PrivGate.Agent.exe.config" || { echo "FAIL: PrivGate.Agent.exe.config missing from dist"; exit 1; }
test -f "$ROOT/agent/dist/PrivGate.Helper.exe.config" || { echo "FAIL: PrivGate.Helper.exe.config missing from dist"; exit 1; }
grep -q "System.Runtime.CompilerServices.Unsafe" "$ROOT/agent/dist/PrivGate.Agent.exe.config" || { echo "FAIL: binding redirect missing from PrivGate.Agent.exe.config"; exit 1; }
grep -q "System.Runtime.CompilerServices.Unsafe" "$ROOT/agent/dist/PrivGate.Helper.exe.config" || { echo "FAIL: binding redirect missing from PrivGate.Helper.exe.config"; exit 1; }

echo "OK: $ROOT/agent/dist"
ls -lh "$ROOT/agent/dist"/*.exe "$ROOT/agent/dist"/*.config
