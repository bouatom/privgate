using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// SYSTEM-side stock-UAC watcher. The tray's 300ms tick cannot see prompts
/// that appear (and often close) during logon, because Explorer delays HKLM Run
/// and the session tray may not exist yet. The broker service is already up
/// from boot, so it records appearances without waiting for a NotifyIcon.
/// Does not hook, dismiss, or bypass UAC.
/// </summary>
static class ConsentBrokerWatch
{
    static readonly TimeSpan TickEvery = TimeSpan.FromMilliseconds(250);
    static readonly ConcurrentDictionary<int, Tracked> Live = new();

    record Tracked(int Session, string UserSid, string Target, bool Reported);

    internal static async Task RunAsync(ApiClient api, CancellationToken ct)
    {
        BrokerLog.Write("consent watch running (broker)");
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Tick(api, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                BrokerLog.Write("consent watch: " + ex.Message);
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

    static async Task Tick(ApiClient api, CancellationToken ct)
    {
        var present = new HashSet<int>();
        Process[] procs;
        try
        {
            procs = Process.GetProcessesByName("consent");
        }
        catch
        {
            return;
        }
        try
        {
            foreach (var proc in procs)
            {
                try
                {
                    var session = proc.SessionId;
                    if (session <= 0) continue;
                    present.Add(proc.Id);
                    await NoteOpen(api, proc.Id, session, ct).ConfigureAwait(false);
                }
                catch
                {
                    // Process exited while we inspected it.
                }
            }
        }
        finally
        {
            foreach (var p in procs)
            {
                try { p.Dispose(); } catch { /* already gone */ }
            }
        }

        foreach (var pid in Live.Keys)
        {
            if (present.Contains(pid)) continue;
            if (!Live.TryRemove(pid, out var closed)) continue;
            var snap = closed;
            _ = Task.Run(() => NoteClosed(api, snap, ct), ct);
        }
    }

    static async Task NoteOpen(ApiClient api, int pid, int session, CancellationToken ct)
    {
        if (Live.TryGetValue(pid, out var existing) && existing.Reported) return;
        var targets = UacTargetCache.Remember(new[] { pid });
        if (targets.Count == 0) return;
        var target = targets[0];
        var userSid = existing?.UserSid ?? "";
        if (userSid.Length == 0) userSid = AutoElevateInspect.SessionUserSid(session);
        if (userSid.Length == 0 || AutoElevateInspect.IsServiceSid(userSid)) return;

        var (hash, publisher) = Authenticode.TryFingerprint(target);
        var res = await api.ReportUacSeenAsync(target, userSid, hash, publisher, ct: ct)
            .ConfigureAwait(false);
        Live[pid] = new Tracked(session, userSid, target, Recorded(res));
    }

    static async Task NoteClosed(ApiClient api, Tracked closed, CancellationToken ct)
    {
        // Tray still running in that session: it classifies and may offer a
        // PrivGate request. Reporting close here would duplicate rows.
        if (TraySessions.HasTray(closed.Session)) return;
        var outcome = UacClassifier.Wire(
            UacClassifier.Classify(closed.UserSid, closed.Target, closed.Session));
        var (hash, publisher) = Authenticode.TryFingerprint(closed.Target);
        try
        {
            await api.ReportUacCanceledAsync(
                    closed.Target, closed.UserSid, outcome, ct, hash, publisher)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            BrokerLog.Write("consent watch close report: " + ex.Message);
        }
    }

    static bool Recorded(JsonElement res)
    {
        try
        {
            if (res.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True) return true;
            if (res.TryGetProperty("error", out var err))
            {
                var s = err.GetString() ?? "";
                if (s.IndexOf("unknown directory user", StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            }
        }
        catch
        {
            // Treat parse failure as not-yet-recorded so the next tick retries.
        }
        return false;
    }
}
