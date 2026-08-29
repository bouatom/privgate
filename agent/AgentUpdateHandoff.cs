using System.Diagnostics;
using System.Text;

namespace PrivGate.Agent;

/// <summary>
/// Windows agent apply cannot spawn msiexec as a child of PrivGateBroker.
/// The MSI ServiceControl stop plus stop-stray.cmd <c>taskkill /F /IM
/// PrivGate.Agent.exe</c> kills that entire tree — including the installer —
/// the same way console <c>service-ctl stop-all</c> used to kill
/// update-server.ps1. A one-shot Scheduled Task runs as SYSTEM outside the
/// service tree. Fail closed if schtasks cannot create or run the task;
/// falling back to a child msiexec is the bug this exists to avoid.
/// </summary>
static class AgentUpdateHandoff
{
    internal const string TaskName = "PrivGate-Agent-Update";

    internal static string BuildTaskXml(string msiexec, string msiPath)
    {
        var args = "/i " + Quote(msiPath) + " /qn /norestart";
        var workDir = Path.GetDirectoryName(msiPath) ?? @"C:\ProgramData\PrivGate\update";
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\n" +
            "  <RegistrationInfo>\n" +
            "    <Description>PrivGate agent self-update (one-shot). Replaced on the next apply.</Description>\n" +
            "  </RegistrationInfo>\n" +
            "  <Triggers>\n" +
            "    <TimeTrigger>\n" +
            "      <StartBoundary>1999-01-01T00:00:00</StartBoundary>\n" +
            "      <Enabled>true</Enabled>\n" +
            "    </TimeTrigger>\n" +
            "  </Triggers>\n" +
            "  <Principals>\n" +
            "    <Principal id=\"Author\">\n" +
            "      <UserId>S-1-5-18</UserId>\n" +
            "      <RunLevel>HighestAvailable</RunLevel>\n" +
            "    </Principal>\n" +
            "  </Principals>\n" +
            "  <Settings>\n" +
            "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n" +
            "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n" +
            "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n" +
            "    <AllowHardTerminate>true</AllowHardTerminate>\n" +
            "    <StartWhenAvailable>true</StartWhenAvailable>\n" +
            "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\n" +
            "    <AllowStartOnDemand>true</AllowStartOnDemand>\n" +
            "    <Enabled>true</Enabled>\n" +
            "    <Hidden>true</Hidden>\n" +
            "    <RunOnlyIfIdle>false</RunOnlyIfIdle>\n" +
            "    <WakeToRun>false</WakeToRun>\n" +
            "    <ExecutionTimeLimit>PT20M</ExecutionTimeLimit>\n" +
            "    <Priority>7</Priority>\n" +
            "  </Settings>\n" +
            "  <Actions Context=\"Author\">\n" +
            "    <Exec>\n" +
            "      <Command>" + XmlEscape(msiexec) + "</Command>\n" +
            "      <Arguments>" + XmlEscape(args) + "</Arguments>\n" +
            "      <WorkingDirectory>" + XmlEscape(workDir) + "</WorkingDirectory>\n" +
            "    </Exec>\n" +
            "  </Actions>\n" +
            "</Task>\n";
    }

    internal static void Run(string msiPath, Action<string> log)
    {
        var dir = Path.GetDirectoryName(msiPath) ?? @"C:\ProgramData\PrivGate\update";
        Directory.CreateDirectory(dir);
        var xmlPath = Path.Combine(dir, "update-task.xml");
        var system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var msiexec = Path.Combine(system, "msiexec.exe");
        var schtasks = Path.Combine(system, "schtasks.exe");
        File.WriteAllText(xmlPath, BuildTaskXml(msiexec, msiPath), Encoding.UTF8);
        log("handoff via scheduled task " + TaskName);
        RunSchtasks(schtasks, "/Delete /TN \"" + TaskName + "\" /F", ignoreFail: true, log);
        var created = RunSchtasks(schtasks, "/Create /TN \"" + TaskName + "\" /XML \"" + xmlPath + "\" /F", ignoreFail: false, log);
        if (created != 0)
        {
            throw new InvalidOperationException("schtasks /Create exited " + created);
        }
        var started = RunSchtasks(schtasks, "/Run /TN \"" + TaskName + "\"", ignoreFail: false, log);
        if (started != 0)
        {
            throw new InvalidOperationException("schtasks /Run exited " + started);
        }
        log("scheduled task started");
    }

    static int RunSchtasks(string schtasks, string arguments, bool ignoreFail, Action<string> log)
    {
        var psi = new ProcessStartInfo
        {
            FileName = schtasks,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        using var proc = Process.Start(psi);
        if (proc == null) throw new InvalidOperationException("schtasks failed to start");
        var stderr = proc.StandardError.ReadToEnd();
        proc.WaitForExit(60_000);
        if (!proc.HasExited)
        {
            try { proc.Kill(); } catch { /* best effort */ }
            throw new TimeoutException("schtasks timed out: " + arguments);
        }
        if (proc.ExitCode != 0 && !ignoreFail)
        {
            log("schtasks failed (" + proc.ExitCode + "): " + arguments + " " + stderr.Trim());
        }
        return proc.ExitCode;
    }

    static string Quote(string value) =>
        value.StartsWith("\"", StringComparison.Ordinal) ? value : "\"" + value + "\"";

    static string XmlEscape(string value) =>
        value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
}
