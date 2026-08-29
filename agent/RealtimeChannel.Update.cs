using System.Text.Json;

namespace PrivGate.Agent;

partial class RealtimeChannel
{
    internal void StartUpdate(string version)
    {
        if (string.IsNullOrWhiteSpace(version)) return;
        updates.BeginUpdate(JsonSerializer.SerializeToElement(new { version }));
    }
}
