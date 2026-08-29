namespace PrivGate.Agent;

/// <summary>
/// Environment-wide stock-UAC follow-up. Default is to offer a PrivGate
/// request (legacy). Collect-only still reports appearances to the console.
/// </summary>
static class UacOffer
{
    static volatile string _mode = "prompt";

    internal static void NoteMode(string? mode)
    {
        var v = (mode ?? "").Trim().ToLowerInvariant();
        if (v == "collect" || v == "prompt") _mode = v;
    }

    internal static bool ShouldAsk => !string.Equals(_mode, "collect", StringComparison.Ordinal);
}
