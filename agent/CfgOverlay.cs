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
            if (string.IsNullOrWhiteSpace(cfg.ApiBase))
            {
                cfg.ApiBase = (key.GetValue("ApiBase") as string ?? "").Trim();
            }
            if (string.IsNullOrWhiteSpace(cfg.EnrollmentToken))
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
}
