# PrivGate Elevation Broker

Windows SYSTEM service. It does **not** disable UAC, store admin passwords, or intercept the UAC dialog.

## What it does

1. Standard user runs `PrivGate.Helper --elevate <file>`.
2. Helper talks to the broker over the `PrivGateElevation` named pipe (not over the network as the user).
3. Broker hashes the file, reads Authenticode publisher, and calls `/api/agent/evaluate` with device HMAC.
4. On an allow ticket it launches **that** file (job object blocks children unless the ticket says otherwise).
5. On a JIT ticket it adds the user SID to local Administrators and registers `PrivGate-JIT-{id}` to remove them at expiry — even if the API is down.

Lab device `dev-lab-01` / secret `lab-device-secret-do-not-use-in-prod` matches the control-plane seed. Prefer **Devices → Download installer** so the PC gets a packaged `Install-PrivGate.ps1`. Replace the lab secret after first real enroll.

See [docs/windows-vm.md](../docs/windows-vm.md).
