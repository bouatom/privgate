using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

if (args.Length < 2 || args[0] != "--elevate")
{
    Console.Error.WriteLine("Usage: PrivGate.Helper --elevate <path> [--user-sid S-1-5-...]");
    return 1;
}

var file = args[1];
var extra = "";
var sid = CurrentUserSid();
for (var i = 2; i < args.Length; i++)
{
    if (args[i] == "--user-sid" && i + 1 < args.Length)
    {
        sid = args[i + 1];
        i++;
        continue;
    }
    extra = extra.Length == 0 ? args[i] : extra + " " + args[i];
}

if (file.EndsWith(".msc", StringComparison.OrdinalIgnoreCase))
{
    extra = extra.Length == 0 ? "\"" + file + "\"" : "\"" + file + "\" " + extra;
    file = Path.Combine(Environment.SystemDirectory, "mmc.exe");
}

var payload = JsonSerializer.Serialize(new
{
    mode = "elevate",
    userSid = sid,
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
        // Fall through to the lab SID used by control-plane seed data.
    }
    return "S-1-5-21-1000-1000-1000-1101";
}
