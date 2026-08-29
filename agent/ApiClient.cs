using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PrivGate.Agent;

public sealed class ApiClient
{
    readonly HttpClient http;
    readonly string deviceId;
    readonly string secret;
    readonly RealtimeChannel? realtime;
    readonly Random random = new Random();

    public ApiClient(string apiBase, string deviceId, string secret, RealtimeChannel? realtime = null)
    {
        http = new HttpClient { BaseAddress = new Uri(apiBase.TrimEnd('/') + "/") };
        this.deviceId = deviceId;
        this.secret = secret;
        this.realtime = realtime;
    }

    public async Task<JsonElement> EvaluateAsync(object body, CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try { return await realtime.EvaluateAsync(body, ct).ConfigureAwait(false); }
            catch (Exception ex)
            {
                BrokerLog.Write("realtime evaluate failed; HTTP fallback: " + ex.Message);
            }
        }
        return await SendAsync(HttpMethod.Post, "/api/agent/evaluate", body, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Side-effect-free allowlist check for the auto-elevate watcher.
    /// Realtime first; HTTP POST /api/agent/silent-allow if the socket is down.
    /// </summary>
    public async Task<JsonElement> SilentAllowAsync(object body, CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try { return await realtime.SilentAllowAsync(body, ct).ConfigureAwait(false); }
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime silent-allow: {ex.Message}"); }
        }
        return await SendAsync(HttpMethod.Post, "/api/agent/silent-allow", body, ct).ConfigureAwait(false);
    }

    public async Task<JsonElement> JitStateAsync(string userSid, CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try { return await realtime.JitStateAsync(userSid, ct).ConfigureAwait(false); }
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime jit-state: {ex.Message}"); }
        }
        return await SendAsync(HttpMethod.Get, $"/api/agent/jit-state?userSid={Uri.EscapeDataString(userSid)}", null, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Reports that stock UAC appeared for a program. Realtime only; dropped
    /// when the websocket is down (the close report still lands later).
    /// </summary>
    public async Task<JsonElement> ReportUacSeenAsync(
        string filePath, string userSid, string fileHash = "", string publisher = "",
        string arguments = "", CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try
            {
                return await realtime.UacSeenAsync(filePath, userSid, ct, fileHash, publisher, arguments)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) { BrokerLog.Write("realtime uac-seen: " + ex.Message); }
        }
        try
        {
            return await SendAsync(
                    HttpMethod.Post,
                    "/api/agent/uac-seen",
                    new { userSid, filePath, fileHash, publisher, arguments },
                    ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            BrokerLog.Write("http uac-seen: " + ex.Message);
            return JsonSerializer.Deserialize<JsonElement>("{\"ok\":false,\"reason\":\"offline\"}");
        }
    }

    /// <summary>
    /// Reports a closed stock-UAC attempt with its classifier outcome over the
    /// realtime channel. Telemetry only: when the websocket is down the report
    /// is dropped (no HTTP fallback).
    /// </summary>
    public async Task<JsonElement> ReportUacCanceledAsync(
        string filePath, string userSid, string outcome = "", CancellationToken ct = default,
        string fileHash = "", string publisher = "", string arguments = "")
    {
        if (realtime is { IsConnected: true })
        {
            try
            {
                return await realtime.UacCanceledAsync(filePath, userSid, ct, outcome, fileHash, publisher, arguments)
                    .ConfigureAwait(false);
            }
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime uac-canceled: {ex.Message}"); }
        }
        return JsonSerializer.Deserialize<JsonElement>("{\"ok\":false,\"reason\":\"offline\"}");
    }

    /// <summary>
    /// Forwards the interactive GUI heartbeat. Realtime only: when the
    /// websocket is down the beat is dropped (the next one lands in ≤60s).
    /// </summary>
    public async Task<JsonElement> ReportClientStatusAsync(int uptimeSec, int pid, CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try
            {
                return await realtime.ClientStatusAsync(uptimeSec, pid, ct).ConfigureAwait(false);
            }
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime client-status: {ex.Message}"); }
        }
        return JsonSerializer.Deserialize<JsonElement>("{\"ok\":false,\"reason\":\"offline\"}");
    }

    /// <summary>
    /// Reports a broker-side launch outcome as launch-result telemetry,
    /// mirroring ReportClientStatusAsync: realtime only, dropped when offline.
    /// </summary>
    public async Task<JsonElement> ReportLaunchResultAsync(
        string requestId, string filePath, bool ok, string detail = "", CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try
            {
                return await realtime.LaunchResultAsync(requestId, filePath, ok, ct, detail).ConfigureAwait(false);
            }
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime launch-result: {ex.Message}"); }
        }
        return JsonSerializer.Deserialize<JsonElement>("{\"ok\":false,\"reason\":\"offline\"}");
    }

    /// <summary>
    /// Reports that the local JIT watchdog revoked an elapsed window. Realtime
    /// only: if offline, the server's expiry sweep reconciles the row instead.
    /// </summary>
    public async Task<JsonElement> ReportJitExpiredAsync(string grantId, CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try
            {
                return await realtime.JitExpiredAsync(grantId, ct).ConfigureAwait(false);
            }
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime jit-expired: {ex.Message}"); }
        }
        return JsonSerializer.Deserialize<JsonElement>("{\"ok\":false,\"reason\":\"offline\"}");
    }

    /// <summary>
    /// Asks the console whether a newer client MSI is available. HTTP so a
    /// check still works if the websocket is up but RPC types are older.
    /// </summary>
    public Task<JsonElement> CheckUpdateAsync(string installed, CancellationToken ct = default)
    {
        var path = "/api/agent/update/check?installed=" + Uri.EscapeDataString(installed ?? "");
        return SendAsync(HttpMethod.Get, path, null, ct);
    }

    public void StartAgentUpdate(string version)
    {
        if (realtime is null)
        {
            throw new InvalidOperationException("the elevation broker is not connected");
        }
        realtime.StartUpdate(version);
    }

    async Task<JsonElement> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var raw = body is null ? "" : JsonSerializer.Serialize(body);
        byte[] rawHash;
        using (var sha256 = SHA256.Create()) { rawHash = sha256.ComputeHash(Encoding.UTF8.GetBytes(raw)); }
        var sha = Authenticode.BytesToHex(rawHash);
        // Retry loop with exponential backoff and jitter. Each attempt must
        // be a new HttpRequestMessage — SendAsync disposes the request, and
        // reusing it throws "The request message was already sent" which
        // used to abort elevate (WS-SOHO-03 Disk Management request).
        const int maxRetries = 3;
        Exception? last = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
            var sig = TicketVerifier.DeviceHmac(secret, ts, method.Method, path.Split('?')[0], sha);
            using var req = new HttpRequestMessage(method, path.TrimStart('/'));
            if (raw.Length > 0)
            {
                req.Content = new StringContent(raw, Encoding.UTF8, "application/json");
            }
            req.Headers.TryAddWithoutValidation("X-Device-Id", deviceId);
            req.Headers.TryAddWithoutValidation("X-Timestamp", ts);
            req.Headers.TryAddWithoutValidation("X-Signature", sig);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            try
            {
                var res = await http.SendAsync(req, ct).ConfigureAwait(false);

                if ((int)res.StatusCode == 429 && attempt < maxRetries)
                {
                    int retryAfterSec = 1;
                    if (res.Headers.RetryAfter?.Delta.HasValue == true)
                    {
                        retryAfterSec = Math.Max(1, (int)res.Headers.RetryAfter.Delta.Value.TotalSeconds);
                    }
                    else if (res.Headers.RetryAfter?.Date.HasValue == true)
                    {
                        var wait = res.Headers.RetryAfter.Date.Value - DateTimeOffset.UtcNow;
                        retryAfterSec = Math.Max(1, (int)wait.TotalSeconds);
                    }
                    else if (res.Headers.TryGetValues("Retry-After", out var retryAfterValues) &&
                             int.TryParse(retryAfterValues.FirstOrDefault(), out var sec))
                    {
                        retryAfterSec = Math.Max(1, sec);
                    }
                    var jitterFactor = 1.0 + (random.NextDouble() * 0.25);
                    var delayMs = (int)(retryAfterSec * 1000 * jitterFactor);
                    await Task.Delay(delayMs, ct).ConfigureAwait(false);
                    continue;
                }

                var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                res.EnsureSuccessStatusCode();
                return JsonSerializer.Deserialize<JsonElement>(text);
            }
            catch (Exception ex) when (attempt < maxRetries)
            {
                last = ex;
                var delayMs = 100 * (int)Math.Pow(2, attempt);
                await Task.Delay(delayMs, ct).ConfigureAwait(false);
            }
        }

        throw last ?? new HttpRequestException($"Request to {path} failed after {maxRetries} retries");
    }
}
