using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Windows.Forms;
using PrivGate.Agent;

internal static class Program
{
    const string TrayMutexName = @"Local\PrivGate.Agent.Tray";

    [STAThread]
    static void Main(string[] args)
    {
        if (BrokerService.ShouldRun(args))
        {
            ServiceBase.Run(new BrokerService());
            return;
        }

        if (args.Contains("--once") || args.Contains("--console"))
        {
            AllocConsole();
            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cts.Cancel();
            };
            BrokerHost.RunAsync(args, cts.Token).GetAwaiter().GetResult();
            return;
        }

        // Tray mode runs with no console: any failure that is not written to
        // broker.log never happened as far as anyone can tell.
        CrashGuard.Attach();

        if (!TryAcquireTrayMutex(out var mutex)) return;
        using (mutex)
        {
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new AgentTrayContext(args));
            }
            catch (Exception ex)
            {
                BrokerLog.Write("tray terminated: " + ex);
                throw;
            }
        }
    }

    /// <summary>
    /// Single-instance guard. A previous tray killed while holding the mutex
    /// leaves it abandoned; WaitOne recovers ownership instead of letting every
    /// future start exit silently without a GUI.
    /// </summary>
    static bool TryAcquireTrayMutex(out Mutex mutex)
    {
        mutex = new Mutex(initiallyOwned: false, TrayMutexName, out var createdNew);
        var acquired = createdNew;
        if (!acquired)
        {
            try
            {
                acquired = mutex.WaitOne(TimeSpan.Zero);
            }
            catch (AbandonedMutexException)
            {
                BrokerLog.Write("tray mutex was abandoned by a previous instance; recovering");
                acquired = true;
            }
        }
        if (!acquired) BrokerLog.Write("another PrivGate tray already owns " + TrayMutexName + "; exiting");
        return acquired;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AllocConsole();
}
