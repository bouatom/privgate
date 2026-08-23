# Deployment Artifact Signing and Verification

PrivGate signs all deployment artifacts (MSI, PowerShell script, .deb) to prevent man-in-the-middle injection attacks. Operators can verify artifact integrity before installation.

## Overview

- **Signing Algorithm**: Ed25519 (IETF standard, high performance)
- **Format**: Base64-encoded signatures
- **Scope**: Signed artifacts include:
  - `PrivGate-Client.msi` (Windows installer)
  - `Install-PrivGate.ps1` (PowerShell deployment script)
  - `privgate-client.deb` (Linux package)

## Key Management

### Key Generation

Signingkeys are automatically generated during first startup:

- **Private Key**: `ProgramData\PrivGate\signing\signing.pem` (Windows) or `/var/lib/privgate/signing/signing.pem` (Unix)
  - Permissions: readable only by PrivGate service (0600)
  - Never transmitted or exported

- **Public Key**: `ProgramData\PrivGate\signing\signing.pub` (Windows) or `/var/lib/privgate/signing/signing.pub` (Unix)
  - Permissions: world-readable (0644)
  - Exported via API for verification

### Retrieving the Public Key

**Endpoint**: `GET /api/public/signing-key` (unauthenticated)

**Response**:
```json
{
  "algorithm": "Ed25519",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...",
  "fingerprint": "sha256:a1b2c3d4e5f6..."
}
```

This endpoint is **public** (no authentication required) to support offline verification.

## Artifact Signing

### MSI (Windows Installer)

**Download endpoint**: `GET /api/devices/client?format=msi`

**Response**:
- Binary MSI file in body
- Signature in `X-PrivGate-Signature` header (base64)
- Detached signature also available at `?format=msi-signature`

**Example**: Download and verify
```powershell
# Download MSI
$msi = "C:\temp\PrivGate-Client.msi"
Invoke-WebRequest -Uri "https://privgate.example.com/api/devices/client?format=msi" `
  -OutFile $msi -Headers @{"X-Enrollment-Token" = $token}

# Download public key
$keyResp = Invoke-RestMethod -Uri "https://privgate.example.com/api/public/signing-key"
$publicKey = $keyResp.publicKey

# Verify signature using OpenSSL or PowerShell
# (Implementation depends on signature verification library available on endpoint machine)
```

### PowerShell Script

**Download endpoint**: `GET /api/devices/client?format=script`

**Response**:
- PowerShell script with signature appended as a comment block at the end

**Format**:
```powershell
# ... script content ...

# PrivGate Script Signature (Ed25519 base64):
# <base64-signature>
```

**Verification** (in PowerShell):
```powershell
# Extract signature from script
$script = Get-Content "Install-PrivGate.ps1" -Raw
$lines = $script -split '\r?\n'
$sigLine = $lines | Select-String "# PrivGate Script Signature"
$signature = ($sigLine -replace '^# PrivGate Script Signature \(Ed25519 base64\):\s*# ', '').Trim()

# Remove signature from script for verification
$scriptToVerify = $script -replace "\r?\n# PrivGate Script Signature.*", ""

# Verify (requires openssl or similar; alternatively, save key and verify via .NET)
```

### Linux Package (.deb)

**Signing**: Uses standard Debian/GPG signing (existing mechanism).
**Verification**: `dpkg-sig -k <key> --verify privgate-client.deb`

## Documentation and Release Notes

### GitHub Release Notes

Include public key fingerprint and verification instructions:

```markdown
## Installation

### Windows

Download and verify the MSI:

1. Download the installer from the console: `https://privgate.example.com/api/devices/client?format=msi`
2. Retrieve the public signing key: `https://privgate.example.com/api/public/signing-key`
3. Verify the signature (instructions in `docs/deployment-verification.md`)

**Public Key Fingerprint (Ed25519 SHA256)**:
```
sha256:a1b2c3d4e5f6... (first 64 chars of fingerprint)
```

### Linux

```bash
dpkg-sig -k <key-id> --verify privgate-client.deb
```
```

### Threat Model

- **Prevents**: Man-in-the-middle injection of malicious agent binary (MITM on HTTP, corporate proxy, DNS hijacking)
- **Does NOT prevent**: Compromise of the console itself (if console is compromised, all artifacts can be signed with malicious intent)
- **Recommended**: Verify console origin via HTTPS and certificate pinning for initial enrollment

## Rotation and Key Management

### When to Rotate Keys

- Quarterly (recommended)
- After suspected key compromise
- When moving to a new PrivGate deployment

### Rotation Steps

1. Generate new key pair
2. Publish new public key in GitHub Release notes
3. Rebuild and redistribute artifacts with new signature
4. Notify users of new fingerprint

## Compliance

This implementation satisfies:

- **NIST SSDF**: PO3.3 (Cryptographic mechanisms for integrity)
- **ISO 27001**: A.14.3.1 (Secure development policy for supply chain)
- **CISA Supply Chain Risk Management**: Artifact integrity verification

## Troubleshooting

### "Signature Verification Failed"

1. **Verify public key fingerprint matches release notes**
   - Download key: `https://privgate.example.com/api/public/signing-key`
   - Compare `fingerprint` field with published fingerprint

2. **Check artifact was not tampered with**
   - If using HTTP, verify via HTTPS and TLS inspection
   - Re-download from authoritative source

3. **Ensure signature algorithm is supported**
   - Ed25519 requires OpenSSL 1.1.1+ or .NET 5.0+
   - Upgrade OpenSSL if necessary

### "Public Key Not Found"

- Ensure `/api/public/signing-key` endpoint is accessible
- Check network connectivity to console
- Verify console is running (check logs for startup errors)
