using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// JIT pushes arriving over the realtime channel. Extracted from
/// RealtimeChannel so the channel stays transport-only and this file owns
/// the grant/revoke product behavior.
/// </summary>
static class JitPush
{
    /// <summary>
    /// Verifies the pushed JIT ticket, grants local admin for the subject,
    /// arms the local revoke watchdog and surfaces a notice that teaches the
    /// no-sign-out workflow.
    /// </summary>
    internal static void ApplyGrant(JsonElement msg, string ticketKey, string deviceId, JitWatchdog watchdog)
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
            "Until " +
            DateTimeOffset.FromUnixTimeSeconds(parsed.exp).ToLocalTime().ToString("HH:mm") +
            ": right-click the shield → Request a program… to start anything elevated — no sign-out needed. " +
            "Start-menu and UAC launches still use your old logon token.");
    }

    /// <summary>Console-initiated revoke: remove membership now and say so.</summary>
    internal static void ApplyRevoke(JsonElement msg, JitWatchdog watchdog)
    {
        var sid = msg.TryGetProperty("userSid", out var sidEl) ? sidEl.GetString() ?? "" : "";
        if (sid.Length > 0) watchdog.RevokeNow(sid);
        BrokerStatus.Current.NoteJit(false);
        BrokerStatus.Current.NoteNotice(
            "JIT admin ended",
            "Temporary local Administrators membership was removed. Finish any installs before the end time.");
    }
}
