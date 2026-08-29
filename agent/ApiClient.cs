using System;
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
            catch (Exception ex) { Console.Error.WriteLine($"PrivGate realtime evaluate: {ex.Message}"); }
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
    /// Reports a closed stock-UAC attempt with its classifier outcome over the
    /// realtime channel. Telemetry only: when the websocket is down the report
    /// is dropped (no HTTP fallback).
    /// </summary>
    public async Task<JsonElement> ReportUacCanceledAsync(
        string filePath, string userSid, string outcome = "", CancellationToken ct = default)
    {
        if (realtime is { IsConnected: true })
        {
            try
            {
                return await realtime.UacCanceledAsync(filePath, userSid, ct, outcome).ConfigureAwait(false);
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

    async Task<JsonElement> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var raw = body is null ? "" : JsonSerializer.Serialize(body);
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        byte[] rawHash;
        using (var sha256 = SHA256.Create()) { rawHash = sha256.ComputeHash(Encoding.UTF8.GetBytes(raw)); }
        var sha = Authenticode.BytesToHex(rawHash);
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

        // Retry loop with exponential backoff and jitter
        const int maxRetries = 3;
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                var res = await http.SendAsync(req, ct);

                // Check for 429 (rate limit)
                if ((int)res.StatusCode == 429)
                {
                    if (attempt < maxRetries)
                    {
                        // Parse Retry-After header (in seconds)
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

                        // Calculate backoff with jitter: (1.0 to 1.25) * retryAfterSec
                        var jitterFactor = 1.0 + (random.NextDouble() * 0.25);
                        var delayMs = (int)(retryAfterSec * 1000 * jitterFactor);
                        await Task.Delay(delayMs, ct).ConfigureAwait(false);
                        continue; // Retry
                    }
                    // All retries exhausted
                    res.EnsureSuccessStatusCode();
                }

                var text = await res.Content.ReadAsStringAsync();
                res.EnsureSuccessStatusCode();
                return JsonSerializer.Deserialize<JsonElement>(text);
            }
            catch (HttpRequestException) when (attempt < maxRetries)
            {
                // Transient error, retry with exponential backoff
                var delayMs = 100 * (int)Math.Pow(2, attempt); // 100ms, 200ms, 400ms
                await Task.Delay(delayMs, ct).ConfigureAwait(false);
            }
        }

        throw new HttpRequestException($"Request to {path} failed after {maxRetries} retries");
    }
}
