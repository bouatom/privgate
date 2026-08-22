# License audit — custom broker vs Microsoft-first

**Date:** 2026-08-22  
**Decision:** **Custom PrivGate control plane + Windows Elevation Broker**  
**Status:** GO (custom). Revisit if Intune EPM is later confirmed licensed.

## What we could check

No Microsoft 365 tenant, Graph token, or Intune admin session is available on this machine. MemPalace has no record of Intune Suite, Endpoint Privilege Management, or Entra ID P2 entitlements.

| Product | What it covers | Gap vs PrivGate MVP |
| --- | --- | --- |
| Intune EPM | Per-file allowlists, support-approved elevation, virtual account (user is **not** added to Administrators), audit in Intune | Needs Intune-managed Windows + EPM license (historically Intune Suite / E5). No confirmed entitlement. |
| Entra PIM (Device Local Administrator) | Time-boxed **tenant-wide** local admin on Entra-joined devices | Not per-device; hybrid/domain-joined PCs are out; token refresh can lag hours. |
| Windows 11 sudo | Still a UAC prompt for a real administrator | Does not let a standard user elevate. |

## Why custom is justified here

1. The product requirement is **one dashboard** across hybrid AD + Entra join types.
2. MVP needs **per-device, per-user JIT windows** (15–60 minutes) with **fail-closed local revoke** — PIM does not do that.
3. Endpoints may be domain-joined without EPM.
4. This repo is the program we were asked to build.

## Coexistence

Do **not** run the PrivGate broker and Microsoft EPM on the same device. Pick one elevation agent per machine.

If EPM is licensed later: keep PrivGate for per-device JIT + unified audit; consider retiring duplicate allowlists.

## Non-negotiables (either path)

- No domain-admin or local-admin passwords on endpoints
- Do not disable UAC
- Do not use `runas /savecred`
