using Microsoft.Win32;

namespace PrivGate.Agent;

static class CfgOverlay
{
    const string KeyPath = @"SOFTWARE\PrivGate\Client";

    internal static Cfg Apply(Cfg cfg)
    {
        cfg.ApiBase = (cfg.ApiBase ?? "").Trim();
        if (cfg.EnrollmentToken != null) cfg.EnrollmentToken = cfg.EnrollmentToken.Trim();
        ApplyRegistry(cfg, RegistryView.Registry64);
        ApplyRegistry(cfg, RegistryView.Registry32);
        return cfg;
    }

    static void ApplyRegistry(Cfg cfg, RegistryView view)
    {
        try
        {
            using var hive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            using var key = hive.OpenSubKey(KeyPath);
            if (key == null) return;
            if (string.IsNullOrWhiteSpace(cfg.ApiBase) || IsWildcardHost(cfg.ApiBase))
            {
                var fromReg = (key.GetValue("ApiBase") as string ?? "").Trim();
                if (!string.IsNullOrWhiteSpace(fromReg) && !IsWildcardHost(fromReg))
                {
                    cfg.ApiBase = fromReg;
                }
            }
            if (string.IsNullOrWhiteSpace(cfg.DeviceId))
            {
                cfg.DeviceId = (key.GetValue("DeviceId") as string ?? "").Trim();
                if (string.IsNullOrWhiteSpace(cfg.DeviceSecret))
                {
                    cfg.DeviceSecret = (key.GetValue("DeviceSecret") as string ?? "").Trim();
                }
                if (string.IsNullOrWhiteSpace(cfg.TicketSigningKey))
                {
                    cfg.TicketSigningKey = (key.GetValue("TicketSigningKey") as string ?? "").Trim();
                }
            }
            // Enrollment is first-run only. Overlaying a leftover MSI token when
            // DeviceId is already set makes every start re-register (and crash
            // the service if the console is briefly unreachable — WS-SOHO-03).
            if (string.IsNullOrWhiteSpace(cfg.DeviceId) && string.IsNullOrWhiteSpace(cfg.EnrollmentToken))
            {
                cfg.EnrollmentToken = (key.GetValue("EnrollmentToken") as string ?? "").Trim();
            }
            if (!cfg.AutoElevate)
            {
                cfg.AutoElevate = AutoElevateWatch.Truthy(key.GetValue("AutoElevate")?.ToString());
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"PrivGate registry overlay ({view}): {ex.Message}");
        }
    }

    /// <summary>
    /// Mirror identity into HKLM so a later MSI that ships empty appsettings
    /// can recover without re-enrolling. Clears EnrollmentToken so a leftover
    /// first-run value cannot force another register.
    /// </summary>
    internal static void PersistIdentity(Cfg cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.DeviceId)) return;
        try
        {
            using var hive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var key = hive.CreateSubKey(KeyPath);
            if (key == null) return;
            if (!string.IsNullOrWhiteSpace(cfg.ApiBase) && !IsWildcardHost(cfg.ApiBase))
            {
                key.SetValue("ApiBase", cfg.ApiBase);
            }
            key.SetValue("DeviceId", cfg.DeviceId);
            if (!string.IsNullOrWhiteSpace(cfg.DeviceSecret))
            {
                key.SetValue("DeviceSecret", cfg.DeviceSecret);
            }
            if (!string.IsNullOrWhiteSpace(cfg.TicketSigningKey))
            {
                key.SetValue("TicketSigningKey", cfg.TicketSigningKey);
            }
            key.DeleteValue("EnrollmentToken", throwOnMissingValue: false);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("PrivGate registry persist: " + ex.Message);
        }
    }

    static bool IsWildcardHost(string apiBase)
    {
        try
        {
            var host = new Uri(apiBase).Host.Trim().ToLowerInvariant();
            return host == "0.0.0.0" || host == "::" || host == "[::]";
        }
        catch
        {
            return false;
        }
    }
}
