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
var sid = CurrentUserSid();
for (var i = 2; i < args.Length - 1; i++)
{
    if (args[i] == "--user-sid") sid = args[i + 1];
}

var payload = JsonSerializer.Serialize(new { mode = "elevate", userSid = sid, filePath = file });
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
