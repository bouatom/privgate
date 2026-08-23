using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed class ApiClient
{
    readonly HttpClient http;
    readonly string deviceId;
    readonly string secret;
    readonly RealtimeChannel? realtime;

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
        var res = await http.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync();
        res.EnsureSuccessStatusCode();
        return JsonSerializer.Deserialize<JsonElement>(text);
    }
}
