using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed class NamedPipeHost(Func<JsonElement, Task<string>> handler)
{
    public const string PipeName = "PrivGateElevation";

    static PipeSecurity AuthenticatedUsersOnly()
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            PipeAccessRights.ReadWrite,
            AccessControlType.Allow));
        return security;
    }

    public async Task ListenAsync(CancellationToken ct)
    {
        Console.WriteLine($"PrivGate broker listening on pipe {PipeName}");
        while (!ct.IsCancellationRequested)
        {
            var server = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                8,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                inBufferSize: 0,
                outBufferSize: 0,
                AuthenticatedUsersOnly());
            await server.WaitForConnectionAsync(ct);
            _ = Task.Run(() => Serve(server), ct);
        }
    }

    async Task Serve(NamedPipeServerStream server)
    {
        using (server)
        using (var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true))
        using (var writer = new StreamWriter(server, Encoding.UTF8, bufferSize: 4096, leaveOpen: true) { AutoFlush = true })
        {
            var line = await reader.ReadLineAsync();
            if (string.IsNullOrWhiteSpace(line)) return;
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
