using System.ServiceProcess;
using PrivGate.Agent;

if (BrokerService.ShouldRun(args))
{
    ServiceBase.Run(new BrokerService());
    return;
}

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};
await BrokerHost.RunAsync(args, cts.Token);
