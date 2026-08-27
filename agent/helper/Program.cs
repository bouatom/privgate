using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

if (args.Length < 2 || args[0] != "--elevate")
{
    Console.Error.WriteLine("Usage: PrivGate.Helper --elevate <path> [extra arguments] [--json]");
    Console.Error.WriteLine("    --json   print the raw machine-readable JSON decision instead of a human summary");
    return 1;
}

// By default the helper prints a human-friendly summary of the decision
// (Elevated:/Denied:/Pending approval:). `--json` opts back into the raw
// machine-readable reply for scripts/callers that parse the result. The flag
// is never forwarded to the target program as an argument.
var jsonMode = args.Contains("--json");

var file = args[1];
var extra = "";
for (var i = 2; i < args.Length; i++)
{
    if (string.Equals(args[i], "--json", StringComparison.Ordinal)) continue;
    extra = extra.Length == 0 ? args[i] : extra + " " + args[i];
}

if (file.EndsWith(".msc", StringComparison.OrdinalIgnoreCase))
{
    extra = extra.Length == 0 ? "\"" + file + "\"" : "\"" + file + "\" " + extra;
    file = Path.Combine(Environment.SystemDirectory, "mmc.exe");
}

// Trust model: this helper runs as the invoking user (launched directly from
// their session), so the token the broker derives from the pipe client's
// process IS our token. The broker ignores any "userSid"/"sessionId" in this
// payload — NamedPipeHost.ClientIdentity binds identity to the client process
// via its own token and logon session — so the fields below are informational
// only (they make broker.log lines readable). There is deliberately no
// --user-sid override: a CLI flag cannot choose who you are.
var payload = JsonSerializer.Serialize(new
{
    mode = "elevate",
    userSid = CurrentUserSid(),
    filePath = file,
    arguments = extra,
    sessionId = System.Diagnostics.Process.GetCurrentProcess().SessionId,
});
using var pipe = new NamedPipeClientStream(".", "PrivGateElevation", PipeDirection.InOut);
pipe.Connect(5000);
using var writer = new StreamWriter(pipe, Encoding.UTF8, bufferSize: 4096, leaveOpen: true) { AutoFlush = true };
using var reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true);
await writer.WriteLineAsync(payload);
var reply = await reader.ReadLineAsync();
Console.WriteLine(jsonMode ? reply : FormatHuman(reply, file));
return 0;

/// <summary>
/// Render the broker's JSON decision as a short, human-friendly line. The
/// reply carries fields decision (allow/deny/pending), jit, pid, reason and
/// requestId; this maps them onto "Elevated:/Approved:", "Denied:" and
/// "Pending approval:". Anything that is not the expected shape passes
/// through verbatim so caller output is never lost on shape drift.
/// </summary>
static string FormatHuman(string? reply, string file)
{
    if (string.IsNullOrEmpty(reply)) return reply ?? "";
    try
    {
        using var doc = JsonDocument.Parse(reply ?? "");
        var root = doc.RootElement;
        var decision = root.TryGetProperty("decision", out var d) && d.ValueKind == JsonValueKind.String
            ? d.GetString()
            : null;
        var isJit = root.TryGetProperty("jit", out var j) && j.ValueKind == JsonValueKind.True;
        var pid = 0;
        if (root.TryGetProperty("pid", out var p)) p.TryGetInt32(out pid);
        var reason = root.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String
            ? r.GetString()
            : null;
        var requestId = root.TryGetProperty("requestId", out var rid) && rid.ValueKind == JsonValueKind.String
            ? rid.GetString()
            : null;

        switch (decision)
        {
            case "allow":
                return isJit && pid > 0
                    ? $"Elevated (JIT): {file} started on this desktop (pid {pid})"
                    : pid > 0
                        ? $"Elevated: {file} (pid {pid})"
                        : $"Approved: {file}";
            case "pending":
                return string.IsNullOrEmpty(requestId)
                    ? $"Pending approval: {file}"
                    : $"Pending approval: {file} (request {requestId})";
            case "deny":
                var why = string.IsNullOrWhiteSpace(reason) ? "denied by policy" : reason!;
                return $"Denied: {why}";
            default:
                return reply ?? "";
        }
    }
    catch (JsonException)
    {
        return reply ?? "";
    }
}

static string CurrentUserSid()
{
    try
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return WindowsIdentity.GetCurrent().User?.Value ?? "";
        }
    }
    catch
    {
        // Non-Windows dry-run: report nothing rather than a fake SID.
    }
    return "";
}
