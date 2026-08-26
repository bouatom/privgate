using System.Collections.Concurrent;

namespace PrivGate.Agent;

/// <summary>
/// Bridges approvals to launches for requests that outlive their asker.
/// The pipe waiter only exists while a tray dialog is still open; when the
/// user closes it (or the request came from the UAC-cancel path), an approval
/// push would otherwise be silently dropped. BrokerHost registers
/// requestId → (file, session) the moment a decision comes back pending, and
/// RealtimeChannel consults this map when an approved ticket has no waiter —
/// so "approved" always means "the program opens", regardless of UI state.
/// </summary>
public static class PendingLaunches
{
    readonly static ConcurrentDictionary<string, (string FilePath, int Session)> Jobs = new();

    public static void Register(string requestId, string filePath, int session)
    {
        if (string.IsNullOrWhiteSpace(requestId) || string.IsNullOrWhiteSpace(filePath)) return;
        Jobs[requestId] = (filePath, session);
    }

    public static bool Take(string requestId, out (string FilePath, int Session) job)
    {
        job = default;
        return !string.IsNullOrWhiteSpace(requestId) && Jobs.TryRemove(requestId, out job);
    }

    /// <summary>
    /// Launches the remembered program for an approval whose pipe waiter is
    /// gone. Fire-and-forget: launch outcome goes to the status notices and
    /// the log, never blocks the realtime thread.
    /// </summary>
    public static void TryLaunch(string requestId)
    {
        if (!Take(requestId, out var job)) return;
        try
        {
            var pid = ElevationHost.Launch(job.FilePath, "", denyChildren: false, sessionId: job.Session);
            if (pid > 0)
            {
                BrokerStatus.Current.NoteNotice(
                    "Program opened",
                    job.FilePath + " is opening with admin rights.");
                return;
            }
            BrokerLog.Write($"approval launch returned no pid for {job.FilePath}");
            BrokerStatus.Current.NoteNotice(
                "Program not started",
                "The request was approved, but " + job.FilePath + " could not be started.");
        }
        catch (Exception ex)
        {
            BrokerLog.Write("approval launch failed: " + ex.Message);
            BrokerStatus.Current.NoteNotice(
                "Program not started",
                "The request was approved, but " + job.FilePath + " could not be started (" + ex.Message + ").");
        }
    }
}
