using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed class JitWatchdog
{
    readonly string statePath;

    public JitWatchdog(string? directory = null)
    {
        var dir = string.IsNullOrWhiteSpace(directory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PrivGate")
            : directory;
        Directory.CreateDirectory(dir);
        statePath = Path.Combine(dir, "jit-revoke.json");
    }

    public void Arm(string grantId, string userSid, DateTimeOffset expiresAt)
    {
        var payload = new JitState(grantId, userSid, expiresAt.ToUnixTimeSeconds());
        File.WriteAllText(statePath, JsonSerializer.Serialize(payload));
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            var stamp = expiresAt.ToLocalTime().ToString("HH:mm");
            var date = expiresAt.ToLocalTime().ToString("MM/dd/yyyy");
            var tr = $"net localgroup Administrators /delete {userSid}";
            Process.Start(new ProcessStartInfo("schtasks.exe",
                $"/Create /F /TN PrivGate-JIT-{grantId} /SC ONCE /ST {stamp} /SD {date} /RU SYSTEM /TR \"{tr}\"")
            {
                UseShellExecute = false,
            })?.WaitForExit(10_000);
        }
    }

    public void RevokeNow(string userSid)
    {
        RevokeLocalAdmin(userSid);
        if (!File.Exists(statePath)) return;
        try
        {
            var state = JsonSerializer.Deserialize<JitState>(File.ReadAllText(statePath));
            if (state is not null && RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                Process.Start(new ProcessStartInfo("schtasks.exe", $"/Delete /F /TN PrivGate-JIT-{state.grantId}")
                {
                    UseShellExecute = false,
                })?.WaitForExit(10_000);
            }
        }
        catch
        {
            // Local revoke still proceeds; the scheduled task is a second line of defense.
        }
        File.Delete(statePath);
    }

    public bool Tick(DateTimeOffset now, Action<string> revokeUser)
    {
        if (!File.Exists(statePath)) return false;
        var state = JsonSerializer.Deserialize<JitState>(File.ReadAllText(statePath));
        if (state is null) return false;
        if (now.ToUnixTimeSeconds() < state.exp) return false;
        revokeUser(state.userSid);
        File.Delete(statePath);
        return true;
    }

    public static void RevokeLocalAdmin(string userSid)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            Console.WriteLine($"[dry-run] revoke local Administrators {userSid}");
            return;
        }
        Process.Start(new ProcessStartInfo("net.exe", $"localgroup Administrators /delete {userSid}")
        {
            UseShellExecute = false,
        })?.WaitForExit(15_000);
    }

    public static void GrantLocalAdmin(string userSid)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            Console.WriteLine($"[dry-run] grant local Administrators {userSid}");
            return;
        }
        Process.Start(new ProcessStartInfo("net.exe", $"localgroup Administrators {userSid} /add")
        {
            UseShellExecute = false,
        })?.WaitForExit(15_000);
    }

    sealed record JitState(string grantId, string userSid, long exp);
}
