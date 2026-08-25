using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

if (args.Length < 2 || args[0] != "--elevate")
{
    Console.Error.WriteLine("Usage: PrivGate.Helper --elevate <path> [extra arguments]");
    return 1;
}

var file = args[1];
var extra = "";
for (var i = 2; i < args.Length; i++)
{
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
Console.WriteLine(reply);
return 0;

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
