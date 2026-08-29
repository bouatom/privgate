using System.Text.Json;

namespace PrivGate.Agent;

static class BrokerLog
{
    // Mirrors the console service config spirit: 10 MB files, keep 8 rotated copies.
    const long MaxBytes = 10 * 1024 * 1024;
    const int KeepBackups = 8;

    // Write is called from the UI thread, named-pipe handlers, realtime tasks
    // and crash handlers. Rotation plus append must not interleave or two
    // threads can both rotate (File.Move races) while a third appends.
    static readonly object Gate = new object();

    internal static string Path { get; } = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "PrivGate",
        "broker.log");

    internal static void Write(string message)
    {
        var line = $"{DateTimeOffset.Now:o} {message}";
        try
        {
            lock (Gate)
            {
                var dir = System.IO.Path.GetDirectoryName(Path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                RotateIfNeeded();
                File.AppendAllText(Path, line + Environment.NewLine);
            }
        }
        catch
        {
            // Never fail the broker because the log file is locked. The
            // shared ProgramData log is often unwritable for the tray
            // (BUILTIN\Users only gets Read+Execute on the service-created
            // file), so fall back to a per-user log: without this the tray
            // is a diagnostic blind spot — its uac.closed lines used to
            // vanish while the broker's side of the same flow appeared.
            try
            {
                var dir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "PrivGate");
                Directory.CreateDirectory(dir);
                File.AppendAllText(System.IO.Path.Combine(dir, "tray.log"), line + Environment.NewLine);
            }
            catch
            {
                // Nothing left to try; drop the line.
            }
        }
        Console.Error.WriteLine(line);
    }

    /// <summary>
    /// Shift broker.log → .1 → … → .8 once the live file passes MaxBytes,
    /// dropping the oldest copy. Best-effort: any failure just means the
    /// append below continues into an oversized file.
    /// </summary>
    static void RotateIfNeeded()
    {
        try
        {
            if (!File.Exists(Path)) return;
            if (new FileInfo(Path).Length < MaxBytes) return;
            var oldest = Path + "." + KeepBackups;
            if (File.Exists(oldest)) File.Delete(oldest);
            for (var i = KeepBackups - 1; i >= 1; i--)
            {
                var src = Path + "." + i;
                if (!File.Exists(src)) continue;
                File.Move(src, Path + "." + (i + 1));
            }
            File.Move(Path, Path + ".1");
        }
        catch
        {
            // Rotation must never break logging or the caller.
        }
    }
}

// Split by responsibility so no file crosses the module-size soft cap:
// this file owns the service wiring / lifecycle (BrokerLog + startup +
// launch telemetry), while the named-pipe request dispatch lives in the
// sibling partial file BrokerHost.Handle.cs. BrokerHost is a partial class
// across the two files; its public surface is unchanged.
partial class BrokerHost
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
        RejectNonRoutableApiBase(cfg);
        if (string.IsNullOrWhiteSpace(cfg.DeviceId) || !string.IsNullOrWhiteSpace(cfg.EnrollmentToken))
        {
            BrokerLog.Write($"registering with {cfg.ApiBase}");
            cfg = await DeviceRegistration.RegisterAsync(cfg, configPath, ct);
            BrokerLog.Write($"registered as {cfg.DeviceId}");
        }

        BrokerStatus.Current.Configure(cfg.DeviceId, cfg.ApiBase);
        var watchdog = new JitWatchdog(cfg.StateDirectory);
        using var realtime = new RealtimeChannel(cfg.ApiBase, cfg.DeviceId, cfg.DeviceSecret, cfg.TicketSigningKey, watchdog, ct);
        var api = new ApiClient(cfg.ApiBase, cfg.DeviceId, cfg.DeviceSecret, realtime);
        var host = new BrokerHost(cfg, api, watchdog, ct);
        _ = Task.Run(() => realtime.RunAsync(), ct);
        if (AutoElevateWatch.Enabled(cfg))
        {
            BrokerLog.Write("auto-elevate enabled");
            _ = Task.Run(() => AutoElevateWatch.RunAsync(api, ct), ct);
        }
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var expired = watchdog.Tick(DateTimeOffset.UtcNow, JitWatchdog.RevokeLocalAdmin);
                    if (expired is not null)
                    {
                        BrokerLog.Write($"jit window elapsed for grant {expired.grantId}; reporting expiry");
                        await api.ReportJitExpiredAsync(expired.grantId);
                    }
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
            // The --once CLI's own token is the honest caller identity.
            Console.WriteLine(await host.Handle(once, PipeIdentity.Self()));
            ready?.TrySetResult(true);
            return;
        }

        ready?.TrySetResult(true);
        BrokerLog.Write("listening");
        var pipe = new NamedPipeHost(host.Handle);
        await pipe.ListenAsync(ct);
    }

    // BrokerHost.Handle (named-pipe request dispatch) lives in the sibling
    // partial file BrokerHost.Handle.cs.

    /// <summary>
    /// A broker must dial the console by a routable address. An ApiBase of a
    /// wildcard (`0.0.0.0`/`::`) is never reachable from another machine — it
    /// means an installer was served with a bogus origin and would otherwise
    /// crash-loop with "The requested address is not valid in its context"
    /// (the WS-SOHO-03 update failure). Refuse loudly instead of crash-looping;
    /// a loopback ApiBase is still allowed for the local `npm run dev` lab.
    /// </summary>
    static void RejectNonRoutableApiBase(Cfg cfg)
    {
        var baseHost = "";
        try
        {
            baseHost = new Uri(cfg.ApiBase).Host.Trim().ToLowerInvariant();
        }
        catch
        {
            // Leave empty; the registration call below reports a clear error.
        }
        if (baseHost == "0.0.0.0" || baseHost == "::" || baseHost == "[::]")
        {
            throw new InvalidOperationException(
                $"ApiBase '{cfg.ApiBase}' is not routable from this PC (wildcard address). " +
                "The console must be reached by its real host/IP. Fix ApiBase and re-run.");
        }
    }

    /// <summary>
    /// Fire-and-forget launch-outcome telemetry to the console (F2). Never
    /// delays or fails the elevate reply: the report is dropped when offline
    /// and failures are logged. Additive only — evaluate's mint-time audit is
    /// untouched; this lands as device.launch.succeeded / device.launch.failed.
    /// </summary>
    void EmitLaunchResult(string? requestId, string filePath, bool ok, string detail)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await _api.ReportLaunchResultAsync(requestId ?? "", filePath, ok, detail, _ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                BrokerLog.Write("launch-result report failed: " + ex.Message);
            }
        }, _ct);
    }
}
