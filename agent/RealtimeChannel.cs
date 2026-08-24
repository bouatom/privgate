using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// Persistent HMAC-authenticated WebSocket to the control plane.
/// Evaluate/JIT run over this socket; tickets and JIT revoke arrive as pushes.
/// </summary>
public sealed class RealtimeChannel : IDisposable
{
    public const string Path = "/api/agent/ws";
    static readonly TimeSpan PendingWait = TimeSpan.FromMinutes(15);
    static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(8);
    static readonly TimeSpan RpcTimeout = TimeSpan.FromSeconds(30);

    readonly string apiBase;
    readonly string deviceId;
    readonly string secret;
    readonly string ticketKey;
    readonly JitWatchdog watchdog;
    readonly UpdateManager updates;
    readonly CancellationToken processCt;
    readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> rpcs = new();
    readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> tickets = new();
    readonly SemaphoreSlim sendLock = new(1, 1);

    ClientWebSocket? socket;
    int rpcSeq;

    public RealtimeChannel(
        string apiBase,
        string deviceId,
        string secret,
        string ticketKey,
        JitWatchdog watchdog,
        CancellationToken processCt)
    {
        this.apiBase = apiBase.TrimEnd('/');
        this.deviceId = deviceId;
        this.secret = secret;
        this.ticketKey = ticketKey;
        this.watchdog = watchdog;
        this.processCt = processCt;
        updates = new UpdateManager(apiBase, deviceId, secret);
    }

    public bool IsConnected => socket?.State == WebSocketState.Open;

    public async Task RunAsync()
    {
        var delayMs = 1000;
        while (!processCt.IsCancellationRequested)
        {
            try
            {
                await ConnectAsync(processCt).ConfigureAwait(false);
                delayMs = 1000;
                BrokerStatus.Current.MarkConnected();
                await ReportVersionAsync(processCt).ConfigureAwait(false);
                await ReceiveLoop(processCt).ConfigureAwait(false);
                BrokerStatus.Current.MarkDisconnected("socket closed");
            }
            catch (OperationCanceledException) when (processCt.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"PrivGate realtime: {ex.Message}");
                BrokerStatus.Current.MarkDisconnected(ex.Message);
            }
            FailPending("realtime disconnected");
            try { socket?.Dispose(); } catch { /* ignore */ }
            socket = null;
            try { await Task.Delay(delayMs, processCt).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
            delayMs = Math.Min(delayMs * 2, 30_000);
        }
    }

    public async Task<JsonElement> EvaluateAsync(object body, CancellationToken ct)
    {
        var result = await RpcAsync(new Dictionary<string, object?> { ["type"] = "evaluate", ["body"] = body }, ct)
            .ConfigureAwait(false);
        if (!TryGetDecision(result, out var decision) || decision != "pending") return result;
        if (!result.TryGetProperty("requestId", out var idEl)) return result;
        var requestId = idEl.GetString() ?? "";
        if (requestId.Length == 0) return result;
        var pushed = await WaitTicketAsync(requestId, ct).ConfigureAwait(false);
        return pushed.ValueKind == JsonValueKind.Undefined ? result : pushed;
    }

    public Task<JsonElement> JitStateAsync(string userSid, CancellationToken ct)
    {
        return RpcAsync(new Dictionary<string, object?> { ["type"] = "jit-state", ["userSid"] = userSid }, ct);
    }

    /// <summary>Reports a cancelled stock-UAC attempt (best-effort telemetry).</summary>
    public Task<JsonElement> UacCanceledAsync(string filePath, string userSid, CancellationToken ct)
    {
        return RpcAsync(
            new Dictionary<string, object?>
            {
                ["type"] = "uac-canceled",
                ["filePath"] = filePath,
                ["userSid"] = userSid,
            },
            ct);
    }

    /// <summary>Tells the server an armed JIT window elapsed locally.</summary>
    public Task<JsonElement> JitExpiredAsync(string grantId, CancellationToken ct)
    {
        return RpcAsync(new Dictionary<string, object?> { ["type"] = "jit-expired", ["grantId"] = grantId }, ct);
    }

    async Task ConnectAsync(CancellationToken ct)
    {
        var ws = new ClientWebSocket();
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        byte[] rawHash;
        using (var sha256 = SHA256.Create()) { rawHash = sha256.ComputeHash(Array.Empty<byte>()); }
        var sig = TicketVerifier.DeviceHmac(secret, ts, "GET", Path, Authenticode.BytesToHex(rawHash));
        ws.Options.SetRequestHeader("X-Device-Id", deviceId);
        ws.Options.SetRequestHeader("X-Timestamp", ts);
        ws.Options.SetRequestHeader("X-Signature", sig);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(ConnectTimeout);
        await ws.ConnectAsync(WsUri(), timeout.Token).ConfigureAwait(false);
        socket = ws;
        Console.WriteLine("PrivGate realtime connected");
    }

    Uri WsUri()
    {
        var uri = new Uri(apiBase + Path);
        var builder = new UriBuilder(uri) { Scheme = uri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws" };
        return builder.Uri;
    }

    async Task ReceiveLoop(CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        while (!ct.IsCancellationRequested && socket?.State == WebSocketState.Open)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None)
                        .ConfigureAwait(false);
                    return;
                }
                ms.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            HandleIncoming(JsonSerializer.Deserialize<JsonElement>(Encoding.UTF8.GetString(ms.ToArray())));
        }
    }

    void HandleIncoming(JsonElement msg)
    {
        var type = msg.TryGetProperty("type", out var t) ? t.GetString() : "";
        if (type == "result" || type == "pong")
        {
            CompleteRpc(msg);
            return;
        }
        if (type == "request-pending")
        {
            var path = msg.TryGetProperty("filePath", out var p) ? p.GetString() ?? "a program" : "a program";
            BrokerStatus.Current.NotePending($"Waiting for approval: {path}");
            BrokerStatus.Current.NoteNotice("Waiting for approval",
                $"An approver must allow {path} in the PrivGate console.");
            return;
        }
        if (type == "ticket")
        {
            BrokerStatus.Current.NotePending("");
            BrokerStatus.Current.NoteNotice("Elevation approved", "The request was approved.");
            CompleteTicket(msg, allow: true);
            return;
        }
        if (type == "request-denied")
        {
            BrokerStatus.Current.NotePending("");
            BrokerStatus.Current.NoteNotice("Elevation denied", "The request was denied.");
            CompleteTicket(msg, allow: false);
            return;
        }
        if (type == "jit-grant")
        {
            ApplyJitGrant(msg);
            return;
        }
        if (type == "jit-revoke")
        {
            var sid = msg.TryGetProperty("userSid", out var sidEl) ? sidEl.GetString() ?? "" : "";
            if (sid.Length > 0) watchdog.RevokeNow(sid);
            BrokerStatus.Current.NoteJit(false);
            BrokerStatus.Current.NoteNotice("JIT admin ended", "Temporary local Administrators membership was removed.");
            return;
        }
        if (type == "agent-update")
        {
            updates.BeginUpdate(msg);
        }
    }

    async Task ReportVersionAsync(CancellationToken ct)
    {
        try
        {
            await RpcAsync(
                new Dictionary<string, object?> { ["type"] = "version-report", ["version"] = UpdateManager.AgentVersion() },
                ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"PrivGate realtime: version-report failed: {ex.Message}");
        }
    }

    void CompleteRpc(JsonElement msg)
    {
        if (!msg.TryGetProperty("id", out var idEl)) return;
        var id = idEl.GetString() ?? "";
        if (id.Length > 0 && rpcs.TryRemove(id, out var waiter))
        {
            waiter.TrySetResult(msg);
        }
    }

    void CompleteTicket(JsonElement msg, bool allow)
    {
        var requestId = msg.TryGetProperty("requestId", out var rid) ? rid.GetString() ?? "" : "";
        if (requestId.Length == 0 || !tickets.TryRemove(requestId, out var waiter)) return;
        if (allow)
        {
            var ticket = msg.TryGetProperty("ticket", out var ticketEl) ? ticketEl.GetString() : "";
            waiter.TrySetResult(JsonSerializer.SerializeToElement(new { decision = "allow", ticket, requestId }));
            return;
        }
        waiter.TrySetResult(JsonSerializer.SerializeToElement(new
        {
            decision = "deny",
            reason = "request denied",
            requestId,
        }));
    }

    void ApplyJitGrant(JsonElement msg)
    {
        var packed = msg.TryGetProperty("ticket", out var ticketEl) ? ticketEl.GetString() ?? "" : "";
        if (packed.Length == 0 || ticketKey.Length == 0) return;
        var parsed = TicketVerifier.Verify(packed, ticketKey, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        if (!parsed.dev.Equals(deviceId, StringComparison.OrdinalIgnoreCase)) return;
        JitWatchdog.GrantLocalAdmin(parsed.sub);
        watchdog.Arm(parsed.nonce, parsed.sub, DateTimeOffset.FromUnixTimeSeconds(parsed.exp));
        BrokerStatus.Current.NoteJit(true, DateTimeOffset.FromUnixTimeSeconds(parsed.exp));
        BrokerStatus.Current.NoteNotice(
            "JIT admin is on",
            "You are in local Administrators until " +
            DateTimeOffset.FromUnixTimeSeconds(parsed.exp).ToLocalTime().ToString("g") +
            ". Request Disk Management from the tray to open it on this desktop without signing out.");
    }

    async Task<JsonElement> RpcAsync(Dictionary<string, object?> payload, CancellationToken ct)
    {
        if (!IsConnected) throw new InvalidOperationException("realtime not connected");
        var id = Interlocked.Increment(ref rpcSeq).ToString();
        payload["id"] = id;
        var tcs = new TaskCompletionSource<JsonElement>();
        rpcs[id] = tcs;
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        await sendLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await socket!.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct)
                .ConfigureAwait(false);
        }
        finally
        {
            sendLock.Release();
        }
        var reply = await AwaitOrTimeout(tcs.Task, RpcTimeout, ct).ConfigureAwait(false);
        if (reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            throw new InvalidOperationException(
                reply.TryGetProperty("error", out var e) ? e.GetString() ?? "rpc failed" : "rpc failed");
        }
        return reply.TryGetProperty("payload", out var payloadEl) ? payloadEl.Clone() : reply.Clone();
    }

    async Task<JsonElement> WaitTicketAsync(string requestId, CancellationToken ct)
    {
        var tcs = tickets.GetOrAdd(requestId, _ => new TaskCompletionSource<JsonElement>());
        try
        {
            return await AwaitOrTimeout(tcs.Task, PendingWait, ct).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            tickets.TryRemove(requestId, out _);
            return default;
        }
    }

    static async Task<T> AwaitOrTimeout<T>(Task<T> task, TimeSpan timeout, CancellationToken ct)
    {
        var delay = Task.Delay(timeout, ct);
        var done = await Task.WhenAny(task, delay).ConfigureAwait(false);
        if (done != task) throw new TimeoutException("realtime timed out");
        return await task.ConfigureAwait(false);
    }

    static bool TryGetDecision(JsonElement result, out string? decision)
    {
        decision = null;
        if (result.ValueKind != JsonValueKind.Object) return false;
        if (!result.TryGetProperty("decision", out var d)) return false;
        decision = d.GetString();
        return true;
    }

    void FailPending(string reason)
    {
        foreach (var kv in rpcs)
        {
            if (rpcs.TryRemove(kv.Key, out var waiter))
                waiter.TrySetException(new InvalidOperationException(reason));
        }
        foreach (var kv in tickets) tickets.TryRemove(kv.Key, out _);
    }

    public void Dispose()
    {
        try { socket?.Dispose(); } catch { /* ignore */ }
        sendLock.Dispose();
    }
}
