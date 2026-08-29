using System.Text.Json;

namespace PrivGate.Agent;

partial class RealtimeChannel
{
    /// <summary>
    /// Records that stock UAC appeared for this program (frequency + identity).
    /// </summary>
    public Task<JsonElement> UacSeenAsync(
        string filePath, string userSid, CancellationToken ct,
        string fileHash = "", string publisher = "", string arguments = "")
    {
        var payload = new Dictionary<string, object?>
        {
            ["type"] = "uac-seen",
            ["filePath"] = filePath,
            ["userSid"] = userSid,
        };
        if (!string.IsNullOrWhiteSpace(fileHash)) payload["fileHash"] = fileHash;
        if (!string.IsNullOrWhiteSpace(publisher)) payload["publisher"] = publisher;
        if (!string.IsNullOrWhiteSpace(arguments)) payload["arguments"] = arguments;
        return RpcAsync(payload, ct, TimeSpan.FromSeconds(4));
    }

    /// <summary>
    /// Reports a closed stock-UAC prompt with its classifier verdict
    /// (best-effort telemetry; empty <paramref name="outcome"/> keeps the
    /// legacy canceled-report shape).
    /// </summary>
    public Task<JsonElement> UacCanceledAsync(
        string filePath, string userSid, CancellationToken ct, string outcome = "",
        string fileHash = "", string publisher = "", string arguments = "")
    {
        var payload = new Dictionary<string, object?>
        {
            ["type"] = "uac-canceled",
            ["filePath"] = filePath,
            ["userSid"] = userSid,
        };
        if (!string.IsNullOrWhiteSpace(outcome)) payload["outcome"] = outcome;
        if (!string.IsNullOrWhiteSpace(fileHash)) payload["fileHash"] = fileHash;
        if (!string.IsNullOrWhiteSpace(publisher)) payload["publisher"] = publisher;
        if (!string.IsNullOrWhiteSpace(arguments)) payload["arguments"] = arguments;
        return RpcAsync(payload, ct, TimeSpan.FromSeconds(4));
    }

    void ApplyUacModePush(JsonElement msg)
    {
        var mode = msg.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String
            ? m.GetString()
            : "";
        BrokerStatus.Current.NoteUacOffer(mode);
    }
}
