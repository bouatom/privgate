using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// SYSTEM-side poller: when a fresh medium-integrity process (or a stock-UAC
/// consent.exe target) is covered by an explicit allowlist, terminate the
/// unelevated instance and relaunch via <see cref="ElevationHost"/> so the
/// user never has to click through UAC. Server-authoritative: every action
/// asks <c>silent-allow</c> first. Off unless <see cref="Enabled"/>.
/// </summary>
static class AutoElevateWatch
{
    static readonly TimeSpan TickEvery = TimeSpan.FromSeconds(1);
    static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(5);
    static readonly TimeSpan PathCooldown = TimeSpan.FromSeconds(45);
    static readonly ConcurrentDictionary<int, byte> Seen = new();
    static readonly ConcurrentDictionary<string, DateTimeOffset> Cooldown =
        new(StringComparer.OrdinalIgnoreCase);
    static readonly ConcurrentDictionary<string, CachedHash> Hashes =
        new(StringComparer.OrdinalIgnoreCase);

    record CachedHash(long WriteTicks, string Hash, string Publisher);

    internal static bool Enabled(Cfg cfg)
    {
        if (cfg.AutoElevate) return true;
        var env = Environment.GetEnvironmentVariable("PRIVGATE_AUTO_ELEVATE");
        return Truthy(env);
    }

    internal static bool Truthy(string? value)
    {
        var v = (value ?? "").Trim();
        return v == "1"
            || v.Equals("true", StringComparison.OrdinalIgnoreCase)
            || v.Equals("yes", StringComparison.OrdinalIgnoreCase);
    }

    internal static async Task RunAsync(ApiClient api, CancellationToken ct)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            BrokerLog.Write("[dry-run] auto-elevate watcher idle (not Windows)");
            return;
        }

        var selfPid = Process.GetCurrentProcess().Id;
        BrokerLog.Write("auto-elevate watcher running");
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Tick(api, selfPid, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                BrokerLog.Write("auto-elevate tick: " + ex.Message);
            }
            try
            {
                await Task.Delay(TickEvery, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    static async Task Tick(ApiClient api, int selfPid, CancellationToken ct)
    {
        Process[] procs;
        try { procs = Process.GetProcesses(); }
        catch { return; }

        var live = new HashSet<int>();
        try
        {
            foreach (var p in procs)
            {
                try { live.Add(p.Id); }
                catch { /* exited */ }
            }
            PruneSeen(live);
            // Consent first: requireAdministrator never produces a medium
            // process — the UAC dialog is the only signal we get.
            if (await TryConsentAsync(api, procs, ct).ConfigureAwait(false)) return;
            await TryMediumAsync(api, procs, selfPid, ct).ConfigureAwait(false);
        }
        finally
        {
            foreach (var p in procs)
            {
                try { p.Dispose(); }
                catch { /* ignore */ }
            }
        }
    }

    static async Task<bool> TryConsentAsync(ApiClient api, Process[] procs, CancellationToken ct)
    {
        foreach (var proc in procs)
        {
            try
            {
                if (!NameIs(proc, "consent")) continue;
                var session = SafeSessionId(proc);
                if (session <= 0) continue;
                if (Seen.ContainsKey(proc.Id)) continue;
                if (!StartedRecently(proc)) continue;

                var remembered = UacTargetCache.Remember(new[] { proc.Id });
                var target = remembered.Count > 0
                    ? remembered[0]
                    : UacTargetCache.FreshTarget(new[] { proc.Id });
                if (target.Length == 0 || IsSkippedImage(target))
                {
                    Seen[proc.Id] = 0;
                    continue;
                }
                if (OnCooldown(target))
                {
                    Seen[proc.Id] = 0;
                    continue;
                }

                var userSid = AutoElevateInspect.SessionUserSid(session);
                if (userSid.Length == 0 || AutoElevateInspect.IsServiceSid(userSid))
                {
                    Seen[proc.Id] = 0;
                    continue;
                }
                var asked = await AskAndMaybeRelaunch(
                    api, proc.Id, target, userSid, session, arguments: "", ct)
                    .ConfigureAwait(false);
                Seen[proc.Id] = 0;
                if (asked) return true;
            }
            catch
            {
                // Leave consent.exe running.
            }
        }
        return false;
    }

    static async Task TryMediumAsync(ApiClient api, Process[] procs, int selfPid, CancellationToken ct)
    {
        foreach (var proc in procs)
        {
            try
            {
                if (proc.Id <= 4 || proc.Id == selfPid) continue;
                if (Seen.ContainsKey(proc.Id)) continue;
                var session = SafeSessionId(proc);
                if (session <= 0) continue;
                if (!StartedRecently(proc)) continue;
                if (!AutoElevateInspect.TryInspect(proc.Id, out var userSid, out var rid))
                    continue;
                if (rid != AutoElevateInspect.MediumIntegrityRid) { Seen[proc.Id] = 0; continue; }
                if (AutoElevateInspect.IsServiceSid(userSid)) { Seen[proc.Id] = 0; continue; }

                var path = AutoElevateInspect.ImagePath(proc.Id);
                if (path.Length == 0 || IsSkippedImage(path) || HardBans.IsBanned(path))
                {
                    Seen[proc.Id] = 0;
                    continue;
                }
                if (OnCooldown(path)) { Seen[proc.Id] = 0; continue; }

                var args = "";
                try
                {
                    args = AutoElevateInspect.RemainingArgs(
                        UacTargetCache.Native.CommandLineOf(proc.Id));
                }
                catch { /* empty args is fine */ }
                var asked = await AskAndMaybeRelaunch(
                    api, proc.Id, path, userSid, session, args, ct)
                    .ConfigureAwait(false);
                if (asked)
                {
                    Seen[proc.Id] = 0;
                    return;
                }
            }
            catch
            {
                // Next pid.
            }
        }
    }

    static async Task<bool> AskAndMaybeRelaunch(
        ApiClient api,
        int pid,
        string path,
        string userSid,
        int sessionId,
        string arguments,
        CancellationToken ct)
    {
        if (!TryHash(path, out var hash, out var publisher) || publisher.Length == 0)
            return false;

        JsonElement payload;
        try
        {
            payload = await api.SilentAllowAsync(new
            {
                userSid,
                entraOid = "",
                filePath = path,
                fileHash = hash,
                publisher,
                arguments,
            }, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            BrokerLog.Write($"auto-elevate silent-allow failed path={path} {ex.Message}");
            return true;
        }

        if (!IsAllow(payload)) return true;

        Cooldown[path] = DateTimeOffset.UtcNow;
        BrokerLog.Write($"auto-elevate allow path={path} pid={pid} session={sessionId}");
        if (!TryTerminate(pid))
        {
            BrokerLog.Write($"auto-elevate terminate failed pid={pid} path={path}");
            return true;
        }
        try
        {
            var launched = ElevationHost.Launch(path, arguments, denyChildren: false, sessionId);
            BrokerLog.Write($"auto-elevate relaunched path={path} pid={launched}");
        }
        catch (Exception ex)
        {
            BrokerLog.Write($"auto-elevate relaunch failed path={path} {ex.Message}");
        }
        return true;
    }

    static bool TryHash(string path, out string hash, out string publisher)
    {
        hash = "";
        publisher = "";
        try
        {
            var write = File.GetLastWriteTimeUtc(path).Ticks;
            if (Hashes.TryGetValue(path, out var cached) && cached.WriteTicks == write)
            {
                hash = cached.Hash;
                publisher = cached.Publisher;
                return hash.Length > 0;
            }
            hash = Authenticode.Sha256File(path);
            publisher = Authenticode.Publisher(path) ?? "";
            if (hash.Length == 0) return false;
            Hashes[path] = new CachedHash(write, hash, publisher);
            return true;
        }
        catch
        {
            return false;
        }
    }

    static bool IsAllow(JsonElement payload)
    {
        try
        {
            return payload.ValueKind == JsonValueKind.Object
                && payload.TryGetProperty("allow", out var a)
                && a.ValueKind == JsonValueKind.True;
        }
        catch
        {
            return false;
        }
    }

    static bool TryTerminate(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            p.Kill();
            return true;
        }
        catch
        {
            return false;
        }
    }

    static bool IsSkippedImage(string path)
    {
        try
        {
            var name = Path.GetFileName(path);
            if (name.Equals("consent.exe", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.Equals("PrivGate.Agent.exe", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.Equals("PrivGate.Helper.exe", StringComparison.OrdinalIgnoreCase)) return true;
            var home = Path.GetFullPath(AppContext.BaseDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var full = Path.GetFullPath(path);
            return full.StartsWith(home + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || full.Equals(home, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return true;
        }
    }

    static bool OnCooldown(string path)
    {
        if (!Cooldown.TryGetValue(path, out var at)) return false;
        if (DateTimeOffset.UtcNow - at < PathCooldown) return true;
        Cooldown.TryRemove(path, out _);
        return false;
    }

    static bool StartedRecently(Process proc)
    {
        try
        {
            return DateTime.UtcNow - proc.StartTime.ToUniversalTime() <= FreshFor;
        }
        catch
        {
            return false;
        }
    }

    static int SafeSessionId(Process proc)
    {
        try { return proc.SessionId; }
        catch { return -1; }
    }

    static bool NameIs(Process proc, string name)
    {
        try { return proc.ProcessName.Equals(name, StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    static void PruneSeen(HashSet<int> live)
    {
        foreach (var pid in Seen.Keys)
        {
            if (!live.Contains(pid)) Seen.TryRemove(pid, out _);
        }
    }
}
