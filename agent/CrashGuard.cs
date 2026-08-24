using System;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Last-line crash handling for the interactive tray. Before this existed, any
/// unhandled exception on the WinForms UI thread (a bad timer tick, a dialog
/// that failed to build) ended the whole tray silently: no icon, no consent
/// watching, and no trace anywhere. Every handler here appends the full
/// exception to %ProgramData%\PrivGate\broker.log before anything exits.
/// </summary>
static class CrashGuard
{
    static bool _attached;

    /// <summary>Must run before any window or control is created.</summary>
    internal static void Attach()
    {
        if (_attached) return;
        _attached = true;

        // Route exceptions thrown inside message-loop callbacks (timer ticks,
        // menu handlers) to Application.ThreadException instead of the default
        // error dialog / teardown, so one bad callback cannot end the tray.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log("ui-thread", e.Exception);

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex) Log("appdomain", ex);
            else BrokerLog.Write($"FATAL[appdomain] {e.ExceptionObject}");
        };

        // Fire-and-forget tasks (pipe reports, in-process broker) must fail to
        // the log, not to the process.
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log("unobserved-task", e.Exception);
            e.SetObserved();
        };
    }

    static void Log(string source, Exception ex)
    {
        BrokerLog.Write($"FATAL[{source}] {ex}");
    }
}
