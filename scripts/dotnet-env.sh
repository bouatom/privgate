#!/usr/bin/env bash
# Source this file, or run scripts with it prepended.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DOTNET_ROOT="${DOTNET_ROOT:-$ROOT/.tools/dotnet}"
export DOTNET_CLI_HOME="${DOTNET_CLI_HOME:-$ROOT/.tools/dotnet-home}"
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export PATH="$DOTNET_ROOT:$PATH"
mkdir -p "$DOTNET_CLI_HOME"
