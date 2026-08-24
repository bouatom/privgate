using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

static class ElevationClient
{
    internal static string Request(string path, int timeoutMs = 16 * 60 * 1000)
    {
        var file = path;
        var extra = "";
        if (file.EndsWith(".msc", StringComparison.OrdinalIgnoreCase))
        {
            extra = "\"" + file + "\"";
            file = Path.Combine(Environment.SystemDirectory, "mmc.exe");
        }
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? "";
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
