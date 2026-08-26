using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// Caller identity derived from the named-pipe client process itself — never
/// from fields inside the JSON payload. UserSid comes from the client
/// process's primary token (GetNamedPipeClientProcessId → OpenProcess →
/// OpenProcessToken(TOKEN_QUERY) → GetTokenInformation(TokenUser) →
/// ConvertSidToStringSid); Session comes from ProcessIdToSessionId on that
/// same PID. Handlers must use these values and ignore any "userSid"/
/// "sessionId" the message carries — a compromised or spoofing client cannot
/// elevate itself past policy by editing its own JSON.
/// </summary>
public sealed class PipeIdentity
{
    public static readonly PipeIdentity Anonymous = new("", 0);

    public PipeIdentity(string userSid, int session)
    {
        UserSid = userSid ?? "";
        Session = session;
    }

    public string UserSid { get; }
    public int Session { get; }

    /// <summary>
    /// Identity of the current process, for in-process Handle calls such as
    /// the --once CLI path. There the caller IS this process, so its own
    /// token is the honest bound identity.
    /// </summary>
    public static PipeIdentity Self()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            return new PipeIdentity(id.User?.Value ?? "", Process.GetCurrentProcess().SessionId);
        }
        catch
        {
            return Anonymous;
        }
    }
}

public sealed class NamedPipeHost(Func<JsonElement, PipeIdentity, Task<string>> handler)
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
        // A dead listener must never masquerade as a healthy service: the
        // service stays Running while every pipe client hangs or fails. Any
        // fault in the accept loop is logged and the loop restarts.
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await AcceptLoop(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                BrokerLog.Write($"pipe listener fault: {ex.Message}");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    async Task AcceptLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var server = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                8,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                // Zero means "system default" in the docs, but zero-sized pipe
                // buffers make writes rendezvous with reads; a client then
                // blocks forever when the serve side is slow. Real sizes keep
                // the kernel buffers absorbing traffic.
                inBufferSize: 4096,
                outBufferSize: 4096,
                AuthenticatedUsersOnly());
            await server.WaitForConnectionAsync(ct).ConfigureAwait(false);
            _ = Task.Run(() => Serve(server), ct);
        }
    }

    async Task Serve(NamedPipeServerStream server)
    {
        try
        {
            using (server)
            using (var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true))
            using (var writer = new StreamWriter(server, Encoding.UTF8, bufferSize: 4096, leaveOpen: true) { AutoFlush = true })
            {
                // A client that connects and never speaks must not hold the
                // instance forever; disposing aborts any pending I/O and the
                // client sees a closed pipe instead of a silent hang.
                var readTask = reader.ReadLineAsync();
                var finished = await Task.WhenAny(readTask, Task.Delay(TimeSpan.FromSeconds(30))).ConfigureAwait(false);
                if (finished != readTask)
                {
                    BrokerLog.Write("pipe: client connected but sent nothing in 30s; dropped");
                    return;
                }
                var line = await readTask.ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(line)) return;
                try
                {
                    var json = JsonSerializer.Deserialize<JsonElement>(line);
                    // The trust boundary: bind identity to the pipe client's own
                    // process/token. Payload-supplied userSid/sessionId are never
                    // consulted (parsing stays tolerant; the fields are unused).
                    var identity = ClientIdentity(server);
                    var reply = await handler(json, identity).ConfigureAwait(false);
                    await writer.WriteLineAsync(reply).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    BrokerLog.Write($"pipe handler fault: {ex.Message}");
                    await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = ex.Message })).ConfigureAwait(false);
                }
            }
        }
        catch (Exception ex)
        {
            BrokerLog.Write($"pipe serve fault: {ex.Message}");
        }
    }

    const uint ProcessQueryLimitedInformation = 0x1000;
    const uint TokenQueryAccess = 0x0008;
    const int TokenUserClass = 1;

    /// <summary>
    /// Derives who is really on the other end of the pipe: their process
    /// token's user SID plus the logon session of their process. Any failure
    /// degrades to Anonymous rather than to something spoofable.
    /// </summary>
    static PipeIdentity ClientIdentity(NamedPipeServerStream server)
    {
        try
        {
            if (!GetNamedPipeClientProcessId(server.SafePipeHandle, out var pid))
            {
                return PipeIdentity.Anonymous;
            }
            var session = ProcessIdToSessionId(pid, out var logon) ? (int)logon : 0;
            return new PipeIdentity(ClientProcessUserSid(pid), session);
        }
        catch
        {
            return PipeIdentity.Anonymous;
        }
    }

    static string ClientProcessUserSid(uint pid)
    {
        var proc = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (proc == IntPtr.Zero) return "";
        try
        {
            if (!OpenProcessToken(proc, TokenQueryAccess, out var token)) return "";
            try
            {
                // Size query first (returns false with ERROR_INSUFFICIENT_BUFFER).
                GetTokenInformation(token, TokenUserClass, IntPtr.Zero, 0, out var needed);
                if (needed == 0) return "";
                var buf = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!GetTokenInformation(token, TokenUserClass, buf, needed, out _)) return "";
                    var user = Marshal.PtrToStructure<TOKEN_USER>(buf);
                    if (user.Sid == IntPtr.Zero || !ConvertSidToStringSid(user.Sid, out var sidPtr))
                    {
                        return "";
                    }
                    try
                    {
                        return Marshal.PtrToStringUni(sidPtr) ?? "";
                    }
                    finally
                    {
                        LocalFree(sidPtr);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
            finally
            {
                CloseHandle(token);
            }
        }
        finally
        {
            CloseHandle(proc);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_USER
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);

    [DllImport("kernel32.dll")]
    static extern bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(
        IntPtr token, int infoClass, IntPtr info, uint infoLength, out uint returnLength);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr stringSid);

    [DllImport("kernel32.dll")]
    static extern IntPtr LocalFree(IntPtr mem);
}
