import "server-only";
import { AGENT_EXE } from "./client-binaries";

/**
 * Windows Firewall plumbing shared by every client deployment flavor.
 *
 * Only PrivGate.Agent.exe needs a rule: it makes all WebSocket/HTTP calls to
 * the console, and a PC with an outbound-restrictive baseline would block it
 * from ever enrolling or reporting in. PrivGate.Helper.exe talks over the
 * local "PrivGateElevation" named pipe exclusively and needs no rule.
 *
 * Three flavors produce the identical outcome (rule name "PrivGate Agent"):
 * - live MSI (src/lib/client-msi.ts) and packaged prebuilt MSI
 *   (packaging/windows/build-client-msi.cjs): ship agentFirewallCmdContent()
 *   as firewall-agent.cmd and run it from FileKey custom actions (wixl has no
 *   WiX Firewall extension support).
 * - deployment / zip install scripts: the PowerShell snippets below.
 */

export const AGENT_FIREWALL_RULE = "PrivGate Agent";

/** Canonical firewall-agent.cmd shipped inside both client MSI flavors (LF; staging converts to CRLF). */
export function agentFirewallCmdContent(): string {
  return `@echo off
setlocal EnableExtensions

rem Keeps PrivGate.Agent.exe able to dial its management console when the PC
rem runs an outbound-restrictive Windows Firewall policy. PrivGate.Helper.exe
rem talks over a local named pipe only and needs no rule.
rem
rem Usage: firewall-agent.cmd add | remove
rem
rem Invoked by the client MSI custom actions; the rule name matches the one the
rem PowerShell installers create ("PrivGate Agent"), so all deployment flavors
rem stay interchangeable. A host without the firewall service makes netsh fail:
rem that is reported but never fatal, because the MSI schedules this helper
rem with Return="ignore".

if /i "%~1"=="add" goto ADD
if /i "%~1"=="remove" goto REMOVE
echo firewall-agent: usage: %~nx0 add^|remove >&2
exit /b 2

:ADD
set "AGENTBIN=%~dp0PrivGate.Agent.exe"
if not exist "%AGENTBIN%" (
  echo firewall-agent: WARNING - %AGENTBIN% not found; outbound rule not created.
  exit /b 1
)
netsh advfirewall firewall delete rule name="${AGENT_FIREWALL_RULE}" >nul 2>&1
netsh advfirewall firewall add rule name="${AGENT_FIREWALL_RULE}" dir=out action=allow program="%AGENTBIN%" profile=any >nul 2>&1
if errorlevel 1 echo firewall-agent: WARNING - netsh could not create the outbound rule. Is the Windows Firewall service running?
echo firewall-agent: outbound rule ready for %AGENTBIN%
exit /b 0

:REMOVE
netsh advfirewall firewall delete rule name="${AGENT_FIREWALL_RULE}" >nul 2>&1
echo firewall-agent: outbound rule removed
exit /b 0
`;
}

/**
 * PowerShell: create/refresh the outbound allow rule. Callers define
 * $InstallDir first (both emitted install scripts do).
 */
export function agentFirewallAllowSnippet(): string {
  return `
# Outbound allow so ${AGENT_EXE} can reach the console even under an
# outbound-restrictive Windows Firewall policy. Delete-then-add keeps re-runs
# idempotent; a host with the firewall service disabled just skips through.
$fwBin = Join-Path $InstallDir "${AGENT_EXE}"
netsh advfirewall firewall delete rule name="${AGENT_FIREWALL_RULE}" | Out-Null
netsh advfirewall firewall add rule name="${AGENT_FIREWALL_RULE}" dir=out action=allow program="$fwBin" profile=any | Out-Null
`;
}

/** PowerShell: remove the outbound rule created by agentFirewallAllowSnippet(). */
export function agentFirewallRemoveSnippet(): string {
  return `
netsh advfirewall firewall delete rule name="${AGENT_FIREWALL_RULE}" | Out-Null
`;
}
