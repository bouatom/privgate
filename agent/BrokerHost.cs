using System.Text.Json;

namespace PrivGate.Agent;

static class BrokerLog
{
    internal static string Path { get; } = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "PrivGate",
        "broker.log");

    internal static void Write(string message)
    {
        var line = $"{DateTimeOffset.Now:o} {message}";
        try
        {
            var dir = System.IO.Path.GetDirectoryName(Path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(Path, line + Environment.NewLine);
        }
        catch
        {
            // Never fail the broker because the log file is locked.
        }
        Console.Error.WriteLine(line);
    }
}

sealed class BrokerHost
{
    readonly Cfg _cfg;
    readonly ApiClient _api;
    readonly JitWatchdog _watchdog;
    readonly CancellationToken _ct;

    BrokerHost(Cfg cfg, ApiClient api, JitWatchdog watchdog, CancellationToken ct)
    {
        _cfg = cfg;
        _api = api;
        _watchdog = watchdog;
        _ct = ct;
    }

    internal static async Task RunAsync(string[] args, CancellationToken ct, TaskCompletionSource<bool>? ready = null)
    {
        var configArg = args.FirstOrDefault(a => a.StartsWith("--config="));
        var configPath = configArg != null
            ? configArg.Substring("--config=".Length)
            : Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        BrokerLog.Write($"starting (config {configPath})");
        var cfg = CfgOverlay.Apply(
            JsonSerializer.Deserialize<Cfg>(File.ReadAllText(configPath))
                ?? throw new InvalidOperationException("appsettings.json missing"));
        cfg.DeviceId ??= "";
        cfg.EnrollmentToken ??= "";
        if (string.IsNullOrWhiteSpace(cfg.DeviceId) || !string.IsNullOrWhiteSpace(cfg.EnrollmentToken))
        {
            BrokerLog.Write($"registering with {cfg.ApiBase}");
            cfg = await DeviceRegistration.RegisterAsync(cfg, configPath, ct);
            BrokerLog.Write($"registered as {cfg.DeviceId}");
        }

        var watchdog = new JitWatchdog(cfg.StateDirectory);
        using var realtime = new RealtimeChannel(cfg.ApiBase, cfg.DeviceId, cfg.DeviceSecret, cfg.TicketSigningKey, watchdog, ct);
        var api = new ApiClient(cfg.ApiBase, cfg.DeviceId, cfg.DeviceSecret, realtime);
        var host = new BrokerHost(cfg, api, watchdog, ct);
        _ = Task.Run(() => realtime.RunAsync(), ct);
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    watchdog.Tick(DateTimeOffset.UtcNow, JitWatchdog.RevokeLocalAdmin);
                }
                catch (Exception ex)
                {
                    BrokerLog.Write(ex.ToString());
                }
                await Task.Delay(TimeSpan.FromSeconds(5), ct).ConfigureAwait(false);
            }
        }, ct);

        if (args.Contains("--once") && args.Length >= 3)
        {
            var once = JsonSerializer.SerializeToElement(new
            {
                mode = "elevate",
                userSid = args[args.Length - 2],
                filePath = args[args.Length - 1],
            });
            Console.WriteLine(await host.Handle(once));
            ready?.TrySetResult(true);
            return;
        }

        ready?.TrySetResult(true);
        BrokerLog.Write("listening");
        var pipe = new NamedPipeHost(host.Handle);
        await pipe.ListenAsync(ct);
    }

    async Task<string> Handle(JsonElement msg)
    {
        var mode = msg.GetProperty("mode").GetString();
        var userSid = msg.GetProperty("userSid").GetString() ?? "";
        if (mode == "jit-status")
        {
            var state = await _api.JitStateAsync(userSid, _ct);
            return state.GetRawText();
        }

        var filePath = msg.GetProperty("filePath").GetString() ?? "";
        var arguments = msg.TryGetProperty("arguments", out var argvEl) ? argvEl.GetString() ?? "" : "";
        if (HardBans.IsBanned(filePath))
        {
            var jit = await _api.JitStateAsync(userSid, _ct);
            var active = jit.TryGetProperty("active", out var a) && a.GetBoolean();
            if (!active)
            {
                return JsonSerializer.Serialize(new { decision = "deny", reason = "hard-banned binary" });
            }
            Environment.SetEnvironmentVariable("PRIVGATE_JIT", "1");
        }

        var hash = Authenticode.Sha256File(filePath);
        var publisher = Authenticode.Publisher(filePath);
        var result = await _api.EvaluateAsync(new
        {
            userSid,
            entraOid = msg.TryGetProperty("entraOid", out var oid) ? oid.GetString() : "",
            filePath,
            fileHash = hash,
            publisher,
            arguments,
        }, _ct);

        var decision = result.GetProperty("decision").GetString();
        if (decision == "allow")
        {
            var ticket = result.GetProperty("ticket").GetString() ?? "";
            var parsed = TicketVerifier.Verify(ticket, _cfg.TicketSigningKey, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            if (!parsed.dev.Equals(_cfg.DeviceId, StringComparison.OrdinalIgnoreCase))
            {
                return JsonSerializer.Serialize(new { decision = "deny", reason = "ticket device mismatch" });
            }
            if (!parsed.sha256.Equals(hash, StringComparison.OrdinalIgnoreCase) && parsed.typ != "jit")
            {
                return JsonSerializer.Serialize(new { decision = "deny", reason = "ticket hash mismatch" });
            }
            if (parsed.typ != "jit" && !parsed.path.Equals(filePath, StringComparison.OrdinalIgnoreCase))
            {
                return JsonSerializer.Serialize(new { decision = "deny", reason = "ticket path mismatch" });
            }
            if (parsed.typ == "jit")
            {
                JitWatchdog.GrantLocalAdmin(parsed.sub);
                _watchdog.Arm(parsed.nonce, parsed.sub, DateTimeOffset.FromUnixTimeSeconds(parsed.exp));
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
}
