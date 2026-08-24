using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace PrivGate.Agent;

/// <summary>
/// Samples which executable owns the foreground window so that when the stock
/// UAC prompt (consent.exe) closes we can name the program the user was trying
/// to elevate. Windows itself does not report this to third parties; sampling
/// the foreground process is a best-effort heuristic. Runs only in the
/// interactive session (tray), never in the service.
/// </summary>
static class ForegroundTracker
{
    const int MaxEntries = 8;

    static readonly object Gate = new object();
    static readonly List<Entry> Recent = new List<Entry>();
    static System.Threading.Timer _timer;
    static string _lastPath = "";

    struct Entry
    {
        public DateTime At;
        public string Path;
    }

    internal static void Start()
    {
        if (_timer != null) return;
        lock (Gate)
        {
            if (_timer != null) return;
            _timer = new System.Threading.Timer(_ => Sample(), null, 250, 250);
        }
    }

    /// <summary>
    /// Best guess at the program the user launched most recently, or "" when
    /// nothing usable was seen within maxAgeMinutes.
    /// </summary>
    internal static string Candidate(int maxAgeMinutes = 10)
    {
        lock (Gate)
        {
            for (var i = Recent.Count - 1; i >= 0; i--)
            {
                if ((DateTime.UtcNow - Recent[i].At).TotalMinutes <= maxAgeMinutes) return Recent[i].Path;
            }
            return "";
        }
    }

    static void Sample()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return;
            if (GetWindowThreadProcessId(hwnd, out var pid) == 0 || pid == 0) return;
            var path = ImagePathOf(pid);            if (string.IsNullOrEmpty(path)) return;
            var name = System.IO.Path.GetFileName(path).ToLowerInvariant();
            // The shell, the UAC dialog itself and our own tray are never the target.
            if (name == "explorer.exe" || name == "consent.exe" || name == "privgate.agent.exe") return;

            lock (Gate)
            {
                if (path == _lastPath)
                {
                    if (Recent.Count > 0) { var e = Recent[Recent.Count - 1]; e.At = DateTime.UtcNow; Recent[Recent.Count - 1] = e; }
                    return;
                }
                _lastPath = path;
                Recent.Add(new Entry { At = DateTime.UtcNow, Path = path });
                if (Recent.Count > MaxEntries) Recent.RemoveAt(0);
            }
        }
        catch
        {
            // Sampling is best effort; never disturb the tray.
        }
    }

    static string ImagePathOf(uint pid)
    {
        try
        {
            using var proc = Process.GetProcessById((int)pid);
            return QueryImageName(pid);
        }
        catch
        {
            return "";
        }
    }

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr hProcess, uint flags, StringBuilder text, ref uint size);

    static string QueryImageName(uint pid)
    {
        const uint queryLimitedInformation = 0x1000;
        var handle = OpenProcess(queryLimitedInformation, false, pid);
        if (handle == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(1024);
            uint size = (uint)sb.Capacity;
            return QueryFullProcessImageName(handle, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally
        {
            CloseHandle(handle);
        }
    }
}
