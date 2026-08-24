using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed class NamedPipeHost(Func<JsonElement, int, Task<string>> handler)
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
                var session = ClientSession(server);
                if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty("sessionId", out var sidEl)
                    && sidEl.TryGetInt32(out var fromMsg) && fromMsg > 0)
                {
                    session = fromMsg;
                }
                var reply = await handler(json, session);
                await writer.WriteLineAsync(reply);
            }
            catch (Exception ex)
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = ex.Message }));
            }
        }
    }

    static int ClientSession(NamedPipeServerStream server)
    {
        try
        {
            if (!GetNamedPipeClientProcessId(server.SafePipeHandle, out var pid)) return 0;
            return ProcessIdToSessionId(pid, out var session) ? (int)session : 0;
        }
        catch
        {
            return 0;
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);

    [DllImport("kernel32.dll")]
    static extern bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);
}
