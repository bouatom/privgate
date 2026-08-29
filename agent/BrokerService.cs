using System.ServiceProcess;

namespace PrivGate.Agent;

sealed class BrokerService : ServiceBase
{
    internal const string Name = "PrivGateBroker";

    CancellationTokenSource? _cts;
    Task? _run;

    public BrokerService()
    {
        ServiceName = Name;
        CanStop = true;
        AutoLog = true;
        CanHandleSessionChangeEvent = true;
    }

    internal static bool ShouldRun(string[] args) =>
        !Environment.UserInteractive
        && !args.Contains("--once")
        && !args.Contains("--console");

    protected override void OnStart(string[] args)
    {
        _cts = new CancellationTokenSource();
        var ready = new TaskCompletionSource<bool>();
        _run = BrokerHost.RunAsync(Array.Empty<string>(), _cts.Token, ready);
        var finished = Task.WaitAny(new Task[] { ready.Task, _run }, TimeSpan.FromSeconds(25));
        if (_run.IsFaulted)
        {
            var ex = _run.Exception?.GetBaseException() ?? new InvalidOperationException("broker failed");
            BrokerLog.Write(ex.ToString());
            throw ex;
        }
        if (finished < 0 || !ready.Task.IsCompleted)
        {
            throw new InvalidOperationException($"Broker did not become ready. See {BrokerLog.Path}");
        }
        TraySessions.EnsureAll();
    }

    protected override void OnSessionChange(SessionChangeDescription change)
    {
        if (change.Reason == SessionChangeReason.SessionLogon
            || change.Reason == SessionChangeReason.ConsoleConnect
            || change.Reason == SessionChangeReason.RemoteConnect)
        {
            TraySessions.EnsureInSession(change.SessionId);
        }
    }

    protected override void OnStop()
    {
        _cts?.Cancel();
        try
        {
            _run?.Wait(TimeSpan.FromSeconds(15));
        }
        catch (Exception ex)
        {
            BrokerLog.Write(ex.ToString());
        }
    }
}
