using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

static class ElevationClient
{
    /// <summary>
    /// Reports the classified outcome of a closed stock-UAC prompt.
    /// Fire-and-forget: never blocks the UI. Failures are logged (they used to
    /// be swallowed whole, which left zero evidence when the broker was down).
    /// With an outcome the server records audit-only telemetry for approved-*
    /// verdicts instead of a canceled request row; without one it behaves
    /// exactly as before (legacy "canceled" path).
    /// </summary>
    internal static void ReportCanceled(string filePath, string outcome = "")
    {
        Task.Run(() =>
        {
            try
            {
                var payload = JsonSerializer.Serialize(new
                {
                    mode = "uac-canceled",
                    filePath = filePath ?? "",
                    userSid = WindowsIdentity.GetCurrent().User?.Value ?? "",
                    outcome = string.IsNullOrWhiteSpace(outcome) ? null : outcome,
                });
                PostOneWay(payload);
            }
            catch (Exception ex)
            {
                BrokerLog.Write("uac-canceled report failed: " + ex.Message);
            }
        });
    }

    /// <summary>
    /// Asks the broker service (LOCAL SYSTEM) to classify the stock-UAC prompt
    /// that just closed: did an administrator approve it, and whose token is
    /// the elevated child running under? Synchronous round-trip; any transport
    /// or parse failure yields Unknown so callers keep today's behavior.
    /// </summary>
    internal static UacOutcome ClassifyClosedPrompt(string filePath, string userSid, int sessionId)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                mode = "uac-classify",
                filePath = filePath ?? "",
                userSid = userSid ?? "",
                sessionId,
            });
            using var pipe = new NamedPipeClientStream(".", NamedPipeHost.PipeName, PipeDirection.InOut);
            pipe.Connect(2000);
            using var writer = new StreamWriter(pipe, Encoding.UTF8, 4096, leaveOpen: true) { AutoFlush = true };
            using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
            writer.WriteLine(payload);
            // Covers the classifier's internal poll window plus pipe latency.
            pipe.ReadTimeout = 6000;
            var reply = reader.ReadLine() ?? "";
            var json = JsonSerializer.Deserialize<JsonElement>(reply);
            return UacClassifier.ParseWire(
                json.TryGetProperty("outcome", out var outcome) ? outcome.GetString() ?? "" : "");
        }
        catch (Exception ex)
        {
            BrokerLog.Write("uac-classify failed: " + ex.Message);
            return UacOutcome.Unknown;
        }
    }

    /// <summary>
    /// Periodic proof of life from the interactive GUI over the broker pipe.
    /// Fire-and-forget like ReportCanceled; while the broker is offline beats
    /// simply fail and the console's last beat ages out naturally.
    /// </summary>
    internal static void SendHeartbeat(int uptimeSec)
    {
        Task.Run(() =>
        {
            try
            {
                var payload = JsonSerializer.Serialize(new
                {
                    mode = "ui-heartbeat",
                    uptimeSec,
                    pid = Process.GetCurrentProcess().Id,
                });
                PostOneWay(payload);
            }
            catch (Exception ex)
            {
                BrokerLog.Write("ui-heartbeat failed: " + ex.Message);
            }
        });
    }

    static void PostOneWay(string payload)
    {
        using var pipe = new NamedPipeClientStream(".", NamedPipeHost.PipeName, PipeDirection.InOut);
        pipe.Connect(2000);
        using var writer = new StreamWriter(pipe, Encoding.UTF8, 4096, leaveOpen: true) { AutoFlush = true };
        using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
        writer.WriteLine(payload);
        pipe.ReadTimeout = 5000;
        reader.ReadLine();
    }

    internal static string Request(string path, int timeoutMs = 16 * 60 * 1000)
    {
        var file = path;
        var extra = "";
        if (file.EndsWith(".msc", StringComparison.OrdinalIgnoreCase))
        {
            extra = "\"" + file + "\"";
            file = Path.Combine(Environment.SystemDirectory, "mmc.exe");
        }
        else if (file.EndsWith(".msi", StringComparison.OrdinalIgnoreCase))
        {
            // CreateProcessAsUser cannot exec a package directly (it would fail
            // with ERROR_BAD_EXE_FORMAT): route it through msiexec like .msc
            // routes through mmc. Same trust model as the .msc wrap — the
            // wrapper binary is what gets hashed and evaluated.
            extra = "/i \"" + file + "\"";
            file = Path.Combine(Environment.SystemDirectory, "msiexec.exe");
        }
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? "";
        // Informational only: the broker derives caller identity from this
        // process's own token via NamedPipeHost.ClientIdentity and ignores
        // payload userSid/sessionId (kept for readable broker.log lines).
        var payload = JsonSerializer.Serialize(new
        {
            mode = "elevate",
            userSid = sid,
            filePath = file,
            arguments = extra,
            sessionId = Process.GetCurrentProcess().SessionId,
        });
        using var pipe = new NamedPipeClientStream(".", NamedPipeHost.PipeName, PipeDirection.InOut);
        pipe.Connect(8000);
        using var writer = new StreamWriter(pipe, Encoding.UTF8, 4096, leaveOpen: true) { AutoFlush = true };
        using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
        writer.WriteLine(payload);
        pipe.ReadTimeout = timeoutMs;
        return reader.ReadLine() ?? "";
    }
}
