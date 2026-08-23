namespace PrivGate.Agent;

sealed class Cfg
{
    public string ApiBase { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string DeviceSecret { get; set; } = "";
    public string TicketSigningKey { get; set; } = "";
    public string? StateDirectory { get; set; }
    public string? EnrollmentToken { get; set; }
}
