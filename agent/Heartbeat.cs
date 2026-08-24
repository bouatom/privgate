using System;
using System.Diagnostics;

namespace PrivGate.Agent;

/// <summary>
/// Proof of life for the management console: the tray sends a ui-heartbeat
/// over the broker pipe once a minute so admins can tell the client GUI is
/// actually running. The broker service alone proves nothing about the user
/// session — the tray can be dead (no icon, no consent watching) while the
/// service looks healthy. Runs only in the interactive session.
/// </summary>
static class Heartbeat
{
    static readonly TimeSpan FirstDelay = TimeSpan.FromSeconds(5);
    static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    // Fully qualified on purpose: net48 resolves System.Threading.Timer and
    // System.Windows.Forms.Timer ambiguously once WinForms is referenced.
    static System.Threading.Timer? _timer;
    static readonly DateTimeOffset StartedAt = DateTimeOffset.UtcNow;

    internal static void Start()
    {
        if (!Environment.UserInteractive || _timer != null) return;
        _timer = new System.Threading.Timer(_ => Beat(), null, FirstDelay, Interval);
    }

    internal static void Stop()
    {
        _timer?.Dispose();
        _timer = null;
    }

    static void Beat()
    {
        try
        {
            var uptime = (int)(DateTimeOffset.UtcNow - StartedAt).TotalSeconds;
            ElevationClient.SendHeartbeat(uptime);
        }
        catch (Exception ex)
        {
            // Telemetry must never take the tray timer down with it.
            BrokerLog.Write("ui-heartbeat failed: " + ex.Message);
        }
    }
}
