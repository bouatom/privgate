using Microsoft.Win32;

namespace PrivGate.Agent;

static class JoinDetect
{
    public static string Current()
    {
        try
        {
            using var azure = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\CloudDomainJoin\JoinInfo");
            var domainJoined = !string.Equals(
                Environment.UserDomainName,
                Environment.MachineName,
                StringComparison.OrdinalIgnoreCase);
            if (azure != null && domainJoined) return "hybrid";
            if (azure != null) return "entra";
            if (domainJoined) return "ad";
        }
        catch
        {
            // Best-effort. The console lists PCs by hostname.
        }
        return "unknown";
    }
}
