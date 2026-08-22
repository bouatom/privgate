using System.Text.Json;
using PrivGate.Agent;

var configArg = args.FirstOrDefault(a => a.StartsWith("--config="));
var configPath = configArg != null
    ? configArg.Substring("--config=".Length)
    : Path.Combine(AppContext.BaseDirectory, "appsettings.json");
var cfg = JsonSerializer.Deserialize<Cfg>(File.ReadAllText(configPath))
    ?? throw new InvalidOperationException("appsettings.json missing");

var api = new ApiClient(cfg.ApiBase, cfg.DeviceId, cfg.DeviceSecret);
var watchdog = new JitWatchdog(cfg.StateDirectory);
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

_ = Task.Run(async () =>
{
    while (!cts.IsCancellationRequested)
    {
        try
        {
            watchdog.Tick(DateTimeOffset.UtcNow, JitWatchdog.RevokeLocalAdmin);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
        }
        await Task.Delay(TimeSpan.FromSeconds(5), cts.Token).ConfigureAwait(false);
    }
}, cts.Token);

async Task<string> Handle(JsonElement msg)
{
    var mode = msg.GetProperty("mode").GetString();
    var userSid = msg.GetProperty("userSid").GetString() ?? "";
    if (mode == "jit-status")
    {
        var state = await api.JitStateAsync(userSid, cts.Token);
        return state.GetRawText();
    }

    var filePath = msg.GetProperty("filePath").GetString() ?? "";
    var arguments = msg.TryGetProperty("arguments", out var argvEl) ? argvEl.GetString() ?? "" : "";
    if (HardBans.IsBanned(filePath))
    {
        var jit = await api.JitStateAsync(userSid, cts.Token);
        var active = jit.TryGetProperty("active", out var a) && a.GetBoolean();
        if (!active)
        {
            return JsonSerializer.Serialize(new { decision = "deny", reason = "hard-banned binary" });
        }
        Environment.SetEnvironmentVariable("PRIVGATE_JIT", "1");
    }

    var hash = Authenticode.Sha256File(filePath);
    var publisher = Authenticode.Publisher(filePath);
    var result = await api.EvaluateAsync(new
    {
        userSid,
        entraOid = msg.TryGetProperty("entraOid", out var oid) ? oid.GetString() : "",
        filePath,
        fileHash = hash,
        publisher,
        arguments,
    }, cts.Token);

    var decision = result.GetProperty("decision").GetString();
    if (decision == "allow")
    {
        var ticket = result.GetProperty("ticket").GetString() ?? "";
        var parsed = TicketVerifier.Verify(ticket, cfg.TicketSigningKey, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        // The control plane derives this device's signing key from the device id, so a
        // ticket for another host will not verify. Check the claim anyway: it keeps the
        // guarantee if an operator ever reuses a key across hosts.
        if (!parsed.dev.Equals(cfg.DeviceId, StringComparison.OrdinalIgnoreCase))
        {
            return JsonSerializer.Serialize(new { decision = "deny", reason = "ticket device mismatch" });
        }
        if (!parsed.sha256.Equals(hash, StringComparison.OrdinalIgnoreCase) && parsed.typ != "jit")
        {
            return JsonSerializer.Serialize(new { decision = "deny", reason = "ticket hash mismatch" });
        }
        // Launch only the path the ticket authorized, not whatever the pipe client asked for.
        if (parsed.typ != "jit" && !parsed.path.Equals(filePath, StringComparison.OrdinalIgnoreCase))
        {
            return JsonSerializer.Serialize(new { decision = "deny", reason = "ticket path mismatch" });
        }
        if (parsed.typ == "jit")
        {
            // Use parsed.sub (cryptographically signed by the server) rather than the
            // pipe-supplied userSid so a malicious pipe client cannot redirect the admin
            // grant to an arbitrary SID.
            JitWatchdog.GrantLocalAdmin(parsed.sub);
            watchdog.Arm(parsed.nonce, parsed.sub, DateTimeOffset.FromUnixTimeSeconds(parsed.exp));
            return JsonSerializer.Serialize(new
            {
                decision = "allow",
                jit = true,
                reason = "JIT window is open. Re-run the application so Windows UAC can prompt; the broker will not launch it as SYSTEM.",
            });
        }
        var pid = ElevationHost.Launch(filePath, arguments, parsed.child == "deny");
        return JsonSerializer.Serialize(new { decision = "allow", pid });
    }
    return result.GetRawText();
}

if (args.Contains("--once") && args.Length >= 3)
{
    var once = JsonSerializer.SerializeToElement(new
    {
        mode = "elevate",
        userSid = args[args.Length - 2],
        filePath = args[args.Length - 1],
    });
    Console.WriteLine(await Handle(once));
    return;
}

var pipe = new NamedPipeHost(Handle);
await pipe.ListenAsync(cts.Token);

sealed record Cfg(string ApiBase, string DeviceId, string DeviceSecret, string TicketSigningKey, string? StateDirectory);
