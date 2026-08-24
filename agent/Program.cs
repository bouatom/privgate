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

        using var mutex = new Mutex(true, TrayMutexName, out var created);
        if (!created) return;

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new AgentTrayContext(args));
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AllocConsole();
}
