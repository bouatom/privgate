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
            // Never fail the broker because the log file is locked.
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

        BrokerStatus.Current.Configure(cfg.DeviceId, cfg.ApiBase);
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
            // The --once CLI runs as the invoking user, so this process's own
            // token is the honest caller identity for the in-process call.
            Console.WriteLine(await host.Handle(once, PipeIdentity.Self()));
            ready?.TrySetResult(true);
            return;
        }

        ready?.TrySetResult(true);
        BrokerLog.Write("listening");
        var pipe = new NamedPipeHost(host.Handle);
        await pipe.ListenAsync(ct);
    }

    async Task<string> Handle(JsonElement msg, PipeIdentity caller)
    {
        var mode = msg.GetProperty("mode").GetString();
        if (mode == "status") return BrokerStatus.Current.ToJson();
        // Trust note: msg.userSid / msg.sessionId are deliberately never read.
        // Identity comes only from the pipe client's own process token
        // (NamedPipeHost.ClientIdentity); a client editing its JSON cannot
        // impersonate another user or desktop session.
        if (mode == "jit-status")
        {
            var state = await _api.JitStateAsync(caller.UserSid, _ct);
            return state.GetRawText();
        }
        if (mode == "uac-canceled")
        {
            await _api.ReportUacCanceledAsync(
                msg.TryGetProperty("filePath", out var canceledPath) ? canceledPath.GetString() ?? "" : "",
                caller.UserSid,
                msg.TryGetProperty("outcome", out var ocEl) && ocEl.ValueKind == JsonValueKind.String
                    ? ocEl.GetString() ?? ""
                    : "",
                _ct);
            return JsonSerializer.Serialize(new { ok = true });
        }
        if (mode == "uac-classify")
        {
            // Runs here, in the service (SYSTEM), because opening the token of
            // an elevated process is routinely denied to the medium-IL tray.
            var candidate = msg.TryGetProperty("filePath", out var clsPath) ? clsPath.GetString() ?? "" : "";
            var outcome = UacClassifier.Classify(caller.UserSid, candidate, caller.Session);
            BrokerLog.Write($"uac.classified outcome={UacClassifier.Wire(outcome)} target={candidate}");
            return JsonSerializer.Serialize(new { outcome = UacClassifier.Wire(outcome) });
        }
        if (mode == "ui-heartbeat")
        {
            // Interactive-GUI liveness from the tray. Validate before it ever
            // reaches the websocket; a bad beat is rejected, never forwarded.
            var uptime = msg.TryGetProperty("uptimeSec", out var upEl) && upEl.TryGetInt32(out var up)
                ? up
                : -1;
            var pid = msg.TryGetProperty("pid", out var pidEl) && pidEl.TryGetInt32(out var parsedPid)
                ? parsedPid
                : 0;
            if (uptime < 0 || pid <= 0)
            {
                return JsonSerializer.Serialize(new { ok = false, error = "uptimeSec/pid invalid" });
            }
            var delivered = true;
            try
            {
                await _api.ReportClientStatusAsync(uptime, pid, _ct);
            }
            catch (Exception)
            {
                // Offline console: stay quiet per-beat so broker.log does not
                // fill with one line a minute, but tell the tray it did not land.
                delivered = false;
            }
            return JsonSerializer.Serialize(new { ok = true, delivered });
        }

        var filePath = msg.GetProperty("filePath").GetString() ?? "";
        var arguments = msg.TryGetProperty("arguments", out var argvEl) ? argvEl.GetString() ?? "" : "";
        if (HardBans.IsBanned(filePath))
        {
            var jit = await _api.JitStateAsync(caller.UserSid, _ct);
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
            userSid = caller.UserSid,
            entraOid = msg.TryGetProperty("entraOid", out var oid) ? oid.GetString() : "",
            filePath,
            fileHash = hash,
            publisher,
            arguments,
        }, _ct);

        var decision = result.GetProperty("decision").GetString();
        var requestId = result.TryGetProperty("requestId", out var reqIdEl) && reqIdEl.ValueKind == JsonValueKind.String
            ? reqIdEl.GetString()
            : null;
        BrokerStatus.Current.NoteRequest(filePath, decision ?? "unknown");
        BrokerLog.Write($"decision={decision} requestId={requestId ?? "-"} file={filePath}");
        if (decision == "allow")
        {
            // Launch + honest outcome reporting shared by the JIT and plain
            // allow paths. pid <= 0 (or a throw) is a failure — never reported
            // as success; every attempt emits launch-result telemetry.
            (int Pid, string Error) StartTicketProcess(bool denyChildren)
            {
                try
                {
                    var launchedPid = ElevationHost.Launch(filePath, arguments, denyChildren, caller.Session);
                    if (launchedPid > 0)
                    {
                        EmitLaunchResult(requestId, filePath, ok: true, "");
                        return (launchedPid, "");
                    }
                    return (0, "the program could not be started on this desktop");
                }
                catch (Exception ex)
                {
                    return (0, ex.Message);
                }
            }

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
                var until = DateTimeOffset.FromUnixTimeSeconds(parsed.exp);
                _watchdog.Arm(parsed.nonce, parsed.sub, until);
                BrokerStatus.Current.NoteJit(true, until);
                BrokerStatus.Current.NotePending("");
                var (pid, launchError) = StartTicketProcess(parsed.child == "deny");
                if (pid <= 0)
                {
                    // The JIT grant stands, but the requested program did not
                    // start. Say so instead of claiming it opened on the
                    // desktop (the old lie when CreateProcessAsUser failed).
                    BrokerLog.Write($"launch failed jit=true file={filePath} detail={launchError}");
                    BrokerStatus.Current.NoteNotice(
                        "Program not started",
                        "Temporary install rights are active, but " + launchError +
                        ". Finish any installs you already started before the window ends.");
                    EmitLaunchResult(requestId, filePath, ok: false, launchError);
                    return JsonSerializer.Serialize(new
                    {
                        decision = "deny",
                        jit = true,
                        reason = "Your temporary admin window is on, but the requested program could not be started (" +
                                 launchError + ").",
                    });
                }
                BrokerStatus.Current.NoteNotice(
                    "JIT admin is on",
                    "You are in local Administrators until " + until.ToLocalTime().ToString("g") +
                    ". The requested program is opening on this desktop. Start-menu shortcuts still use your old logon token.");
                return JsonSerializer.Serialize(new
                {
                    decision = "allow",
                    jit = true,
                    pid,
                    reason = "JIT is on. The requested program was started on your desktop. You do not need to sign out for this window.",
                });
            }
            BrokerStatus.Current.NotePending("");
            var (launched, allowError) = StartTicketProcess(parsed.child == "deny");
            if (launched <= 0)
            {
                BrokerLog.Write($"launch failed file={filePath} detail={allowError}");
                BrokerStatus.Current.NoteNotice(
                    "Program not started",
                    "Approval was granted, but " + allowError + ".");
                EmitLaunchResult(requestId, filePath, ok: false, allowError);
                return JsonSerializer.Serialize(new
                {
                    decision = "deny",
                    reason = "Approved, but the program could not be started (" + allowError + ").",
                });
            }
            return JsonSerializer.Serialize(new { decision = "allow", pid = launched });
        }
        if (decision == "pending")
        {
            BrokerStatus.Current.NotePending($"Waiting for approval: {filePath}");
            BrokerStatus.Current.NoteNotice(
                "Waiting for approval",
                $"An approver must allow {filePath} in the PrivGate console.");
        }
        else if (decision == "deny")
        {
            BrokerStatus.Current.NotePending("");
            // Surface the server's decision reason instead of a bare denial;
            // fall back to the generic text when the payload has none.
            var denyReason = result.TryGetProperty("reason", out var rEl) && rEl.ValueKind == JsonValueKind.String
                ? (rEl.GetString() ?? "").Trim()
                : "";
            BrokerStatus.Current.NoteNotice(
                "Request denied",
                string.IsNullOrWhiteSpace(denyReason)
                    ? "The request was denied."
                    : "Denied by policy: " + denyReason);
        }
        return result.GetRawText();
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
