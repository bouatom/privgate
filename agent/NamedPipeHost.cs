using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed class NamedPipeHost(Func<JsonElement, Task<string>> handler)
{
    public const string PipeName = "PrivGateElevation";

    public async Task ListenAsync(CancellationToken ct)
    {
        Console.WriteLine($"PrivGate broker listening on pipe {PipeName}");
        while (!ct.IsCancellationRequested)
        {
            using var server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
            await server.WaitForConnectionAsync(ct);
            using var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true);
            using var writer = new StreamWriter(server, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var json = JsonSerializer.Deserialize<JsonElement>(line);
                var reply = await handler(json);
                await writer.WriteLineAsync(reply);
            }
            catch (Exception ex)
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = ex.Message }));
            }
        }
    }
}
