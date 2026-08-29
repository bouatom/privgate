using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PrivGate.Agent;

/// <summary>
/// Starts the per-session tray on interactive desktops. HKLM Run fires late
/// (Explorer delays Run-key programs by several seconds after logon). The
/// service starts a tray on SessionLogon / ConsoleConnect, retries while
/// WinSta is still coming up, and watches so a missed session-change still
/// gets a shield. Both paths must collapse to one process per session.
/// </summary>
static class TraySessions
{
    const int WtsActive = 0;
    const int WtsConnected = 1;
    static readonly object Gate = new();

    /// <summary>
    /// Tight loop at logon (desktop/token races), then a slow keep-alive so
    /// a missed SessionLogon still gets a tray without waiting on HKLM Run.
    /// </summary>
    internal static async Task WatchAsync(CancellationToken ct)
    {
        BrokerLog.Write("tray session watch running");
        var started = DateTime.UtcNow;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                EnsureAll();
            }
            catch (Exception ex)
            {
                BrokerLog.Write("tray session watch: " + ex.Message);
            }
            var burst = DateTime.UtcNow - started < TimeSpan.FromSeconds(45);
            try
            {
                await Task.Delay(burst ? 400 : 2000, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    internal static void EnsureAll()
    {
        foreach (var sessionId in InteractiveSessionIds())
        {
            EnsureInSession(sessionId);
        }
    }

    internal static bool HasTray(int sessionId) => CountInSession(sessionId) > 0;

    internal static void EnsureInSession(int sessionId)
    {
        if (sessionId <= 0) return;
        lock (Gate)
        {
            ReapDuplicates(sessionId);
            if (CountInSession(sessionId) > 0) return;
            var exe = Path.Combine(AppContext.BaseDirectory, "PrivGate.Agent.exe");
            if (!File.Exists(exe)) return;
            SessionLaunch.InSessionAsLoggedOnUser(sessionId, exe);
        }
    }

    /// <summary>
    /// One shield per session. Extra PrivGate.Agent.exe processes in the same
    /// session are leftovers from logon (Run key + SessionLogon) or a user
    /// switch; keep the oldest and stop the rest.
    /// </summary>
    static void ReapDuplicates(int sessionId)
    {
        var trays = InSession(sessionId);
        if (trays.Count <= 1)
        {
            DisposeAll(trays);
            return;
        }
        trays.Sort((a, b) => a.Id.CompareTo(b.Id));
        for (var i = 1; i < trays.Count; i++)
        {
            try
            {
                BrokerLog.Write($"tray duplicate killed pid={trays[i].Id} session={sessionId}");
                trays[i].Kill();
            }
            catch (Exception ex)
            {
                BrokerLog.Write($"tray duplicate kill failed pid={trays[i].Id}: {ex.Message}");
            }
        }
        DisposeAll(trays);
    }

    static int CountInSession(int sessionId)
    {
        var trays = InSession(sessionId);
        var n = trays.Count;
        DisposeAll(trays);
        return n;
    }

    static List<Process> InSession(int sessionId)
    {
        Process[] procs;
        try
        {
            procs = Process.GetProcessesByName("PrivGate.Agent");
        }
        catch
        {
            return new List<Process>();
        }
        var match = new List<Process>();
        foreach (var p in procs)
        {
            try
            {
                if (p.SessionId == sessionId) match.Add(p);
                else p.Dispose();
            }
            catch
            {
                p.Dispose();
            }
        }
        return match;
    }

    static void DisposeAll(List<Process> procs)
    {
        foreach (var p in procs)
        {
            try { p.Dispose(); } catch { /* already disposed */ }
        }
    }

    static int[] InteractiveSessionIds()
    {
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var ptr, out var count) || ptr == IntPtr.Zero)
        {
            return Array.Empty<int>();
        }
        try
        {
            var size = Marshal.SizeOf<WTS_SESSION_INFO>();
            var ids = new List<int>();
            for (var i = 0; i < count; i++)
            {
                var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(IntPtr.Add(ptr, i * size));
                if (info.SessionId <= 0) continue;
                if (info.State != WtsActive && info.State != WtsConnected) continue;
                ids.Add(info.SessionId);
            }
            return ids.ToArray();
        }
        finally
        {
            WTSFreeMemory(ptr);
        }
    }

    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr sessionInfo, out int count);

    [DllImport("wtsapi32.dll")]
    static extern void WTSFreeMemory(IntPtr memory);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WTS_SESSION_INFO
    {
        public int SessionId;
        public IntPtr pWinStationName;
        public int State;
    }
}
