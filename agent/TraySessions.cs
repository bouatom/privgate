using System.Runtime.InteropServices;

namespace PrivGate.Agent;

/// <summary>
/// Starts the per-session tray on interactive desktops. HKLM Run only fires
/// at logon, and MSI stop-stray kills every PrivGate.Agent.exe — including
/// trays — so a service restart after update would otherwise leave every
/// logged-on user without a shield until they sign in again.
/// </summary>
static class TraySessions
{
    const int WtsActive = 0;
    const int WtsConnected = 1;

    internal static void EnsureAll()
    {
        foreach (var sessionId in InteractiveSessionIds())
        {
            EnsureInSession(sessionId);
        }
    }

    internal static void EnsureInSession(int sessionId)
    {
        if (sessionId <= 0) return;
        var exe = Path.Combine(AppContext.BaseDirectory, "PrivGate.Agent.exe");
        if (!File.Exists(exe)) return;
        SessionLaunch.InSessionAsLoggedOnUser(sessionId, exe);
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
