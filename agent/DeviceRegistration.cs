using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

static class DeviceRegistration
{
    public static async Task<Cfg> RegisterAsync(Cfg cfg, string configPath, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cfg.ApiBase) || string.IsNullOrWhiteSpace(cfg.EnrollmentToken))
        {
            throw new InvalidOperationException("ApiBase and EnrollmentToken are required to register this PC.");
        }

        using var http = new HttpClient { BaseAddress = new Uri(cfg.ApiBase.TrimEnd('/') + "/") };
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/agent/register");
        req.Headers.TryAddWithoutValidation("X-Enrollment-Token", cfg.EnrollmentToken);
        var payload = JsonSerializer.Serialize(new
        {
            hostname = Environment.MachineName,
            joinType = JoinDetect.Current(),
        });
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Registration failed ({(int)res.StatusCode}): {text}");
        }

        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        cfg.DeviceId = root.GetProperty("deviceId").GetString() ?? "";
        cfg.DeviceSecret = root.GetProperty("deviceSecret").GetString() ?? "";
        cfg.TicketSigningKey = root.GetProperty("ticketSigningKey").GetString() ?? "";
        cfg.EnrollmentToken = "";
        if (string.IsNullOrWhiteSpace(cfg.DeviceId) || string.IsNullOrWhiteSpace(cfg.DeviceSecret))
        {
            throw new InvalidOperationException("Registration response was missing device credentials.");
        }

        File.WriteAllText(configPath, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));
        return cfg;
    }
}
