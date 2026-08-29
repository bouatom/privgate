using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// Auxiliary named-pipe modes handled beside BrokerHost.Handle's core flows.
/// Kept separate to honor the module-size budget; everything here follows the
/// same trust rule as the core: identity comes from the client process token
/// (<see cref="PipeIdentity"/>), never from payload fields.
/// </summary>
static class PipeAux
{
    /// <summary>
    /// Handles uac-seen and jit-open. Returns null for messages this class
    /// does not own so the caller can fall through to the main dispatcher.
    /// </summary>
    internal static string? Handle(JsonElement msg, PipeIdentity caller, JitWatchdog watchdog, ApiClient api)
    {
        var mode = msg.TryGetProperty("mode", out var m) ? m.GetString() : "";
        if (mode == "uac-seen") return RememberConsent(msg, caller, api);
        if (mode == "jit-open") return JitOpen(msg, caller, watchdog);
        return null;
    }

    /// <summary>
    /// Tray saw consent.exe PIDs appear; snapshot their command lines now,
    /// while the prompt is open, so a later cancel resolves the exact target.
    /// </summary>
    static string RememberConsent(JsonElement msg, PipeIdentity caller, ApiClient api)
    {
        var pids = new List<int>();
        if (msg.TryGetProperty("pids", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in arr.EnumerateArray())
            {
                if (el.TryGetInt32(out var pid) && pid > 0) pids.Add(pid);
            }
        }
        var targets = UacTargetCache.Remember(pids);
        // Broker ConsentBrokerWatch records appearances. This path only
        // snapshots targets so the tray can pre-fill the follow-up ask.
        return JsonSerializer.Serialize(new { ok = true, remembered = pids.Count, targets });
    }

    /// <summary>
    /// One-click elevated launch for users holding an active JIT window: no
    /// request round-trip, no review form — they are local administrators for
    /// the window's duration. Hard-banned binaries stay denied locally and the
    /// launch runs in the caller's own desktop session.
    /// </summary>
    static string JitOpen(JsonElement msg, PipeIdentity caller, JitWatchdog watchdog)
    {
        if (!watchdog.IsJitActiveFor(caller.UserSid))
        {
            return JsonSerializer.Serialize(new { error = "no active JIT window" });
        }
        var filePath = msg.TryGetProperty("filePath", out var f) ? f.GetString() ?? "" : "";
        if (filePath.Length == 0)
        {
            return JsonSerializer.Serialize(new { error = "filePath missing" });
        }
        if (HardBans.IsBanned(filePath))
        {
            BrokerLog.Write($"jit-open denied (hard-banned) user={caller.UserSid} file={filePath}");
            return JsonSerializer.Serialize(new { decision = "deny", reason = "hard-banned binary" });
        }
        int pid;
        try
        {
            pid = ElevationHost.Launch(filePath, "", denyChildren: false, sessionId: caller.Session);
        }
        catch (Exception ex)
        {
            BrokerLog.Write($"jit-open launch failed user={caller.UserSid} file={filePath}: {ex.Message}");
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
        BrokerStatus.Current.NoteRequest(filePath, "jit-open");
        BrokerLog.Write($"jit-open launched pid={pid} user={caller.UserSid} file={filePath}");
        return JsonSerializer.Serialize(new { pid });
    }
}
