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
    /// Tells the broker (LOCAL SYSTEM) which consent.exe PIDs just appeared so
    /// it can snapshot their command lines while the prompt is open. The reply
    /// carries the exact target program paths extracted from those command
    /// lines — far better evidence than the foreground-window guess, and
    /// available the instant the prompt shows. Best-effort: empty array when
    /// the broker could not read anything.
    /// </summary>
    internal static string[] ConsentTargets(IReadOnlyCollection<int> pids)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new { mode = "uac-seen", pids });
            var reply = Exchange(payload, 3000);
            var json = JsonSerializer.Deserialize<JsonElement>(reply);
            if (!json.TryGetProperty("targets", out var arr) || arr.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<string>();
            }
            var targets = new List<string>();
            foreach (var el in arr.EnumerateArray())
            {
                var t = el.GetString() ?? "";
                if (t.Length > 0) targets.Add(t);
            }
            return targets.ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
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
            // Covers the classifier's internal poll window plus pipe latency.
            var reply = Exchange(payload, 9000);
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

    /// <summary>
    /// One request/reply exchange with the broker over the elevation pipe,
    /// under a hard deadline. Pipe streams do not support ReadTimeout (the
    /// Stream base setter always throws InvalidOperationException), so the
    /// whole connect/write/read runs on the thread pool and the caller's
    /// wait is what enforces the ceiling. A timeout throws TimeoutException
    /// whose message genuinely reflects waiting, never a fake instant hit.
    /// </summary>
    static string Exchange(string payload, int timeoutMs)
    {
        var exchange = Task.Run(() =>
        {
            using var pipe = new NamedPipeClientStream(".", NamedPipeHost.PipeName, PipeDirection.InOut);
            pipe.Connect(Math.Min(timeoutMs, 8000));
            using var writer = new StreamWriter(pipe, Encoding.UTF8, 4096, leaveOpen: true) { AutoFlush = true };
            using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
            writer.WriteLine(payload);
            return reader.ReadLine() ?? "";
        });
        if (!exchange.Wait(timeoutMs))
        {
            throw new TimeoutException("the broker did not reply within " + (timeoutMs / 1000) + "s");
        }
        return exchange.Result;
    }

    static void PostOneWay(string payload)
    {
        // Best effort: one-way posts stay quiet on failure so an offline
        // broker does not turn each 60s heartbeat into log spam. The ack is
        // still awaited briefly — dropping the connection before the broker
        // writes its reply used to log 'pipe is broken' fault pairs there.
        try
        {
            Exchange(payload, 7000);
        }
        catch
        {
            // Fire-and-forget by contract.
        }
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
        // True ceiling: the broker holds this pipe open while the request
        // pends console-side — approval or denial ends it early, and the
        // broker's own 15-minute waiter always beats this deadline.
        return Exchange(payload, timeoutMs);
    }
}
