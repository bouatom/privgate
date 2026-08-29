namespace PrivGate.Agent;

sealed class Cfg
{
    public string ApiBase { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string DeviceSecret { get; set; } = "";
    public string TicketSigningKey { get; set; } = "";
    public string? StateDirectory { get; set; }
    public string? EnrollmentToken { get; set; }
    /// <summary>
    /// Opt-in silent relaunch of allowlisted apps (no UAC). Default off.
    /// Also enabled by env <c>PRIVGATE_AUTO_ELEVATE=1</c> or HKLM DWORD AutoElevate.
    /// </summary>
    public bool AutoElevate { get; set; }
}
