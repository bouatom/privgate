using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
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
            var tr = $"net localgroup Administrators {MemberArg(userSid)} /delete";
            // The member argument carries quotes; schtasks /TR needs them
            // escaped or the stored task command is mangled and the revoke
            // fires a broken net.exe line (seen in the field: syntax error
            // from a task whose /TR lost its inner quotes).
            var trEscaped = tr.Replace("\"", "\\\"");
            Process.Start(new ProcessStartInfo("schtasks.exe",
                $"/Create /F /TN PrivGate-JIT-{grantId} /SC ONCE /ST {stamp} /SD {date} /RU SYSTEM /TR \"{trEscaped}\"")
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

    /// <summary>
    /// Removes local admin when the armed window has elapsed and clears state.
    /// Returns the revoked state so the caller can report expiry to the server,
    /// or null when nothing was due.
    /// </summary>
    internal JitState? Tick(DateTimeOffset now, Action<string> revokeUser)
    {
        if (!File.Exists(statePath)) return null;
        var state = JsonSerializer.Deserialize<JitState>(File.ReadAllText(statePath));
        if (state is null) return null;
        if (now.ToUnixTimeSeconds() < state.exp) return null;
        revokeUser(state.userSid);
        File.Delete(statePath);
        return state;
    }

    /// <summary>
    /// True when the given user SID currently holds the local JIT window
    /// (jit-revoke.json names them and the expiry has not passed). Read-only;
    /// used by the jit-open pipe shortcut so JIT users skip the request flow.
    /// </summary>
    public bool IsJitActiveFor(string userSid)
    {
        try
        {
            if (!File.Exists(statePath)) return false;
            var state = JsonSerializer.Deserialize<JitState>(File.ReadAllText(statePath));
            return state is not null
                && state.userSid.Equals(userSid ?? "", StringComparison.OrdinalIgnoreCase)
                && DateTimeOffset.UtcNow.ToUnixTimeSeconds() < state.exp;
        }
        catch
        {
            return false;
        }
    }

    public static void RevokeLocalAdmin(string userSid) => RunNet("delete", userSid);

    public static void GrantLocalAdmin(string userSid) => RunNet("add", userSid);

    /// <summary>
    /// net.exe rejects a bare SID. Prefix with * so the SAM lookup uses the SID.
    /// </summary>
    internal static string MemberSpec(string userSid)
    {
        var value = (userSid ?? "").Trim().Trim('"');
        if (value.StartsWith("S-1-", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("*", StringComparison.Ordinal))
            value = "*" + value;
        return "\"" + value.Replace("\"", "") + "\"";
    }

    /// <summary>
    /// Member argument for net.exe / schtasks. Windows builds in the field
    /// reject SID-form members outright — "*S-1-…", bare "S-1-…", quoted or
    /// not, add or delete, all return a syntax dump — so resolve the SID to
    /// its account name first and only fall back to the *SID form when the
    /// translation fails (e.g. a deleted account).
    /// </summary>
    internal static string MemberArg(string userSid)
    {
        try
        {
            var name = new SecurityIdentifier(userSid).Translate(typeof(NTAccount)).Value;
            if (!string.IsNullOrWhiteSpace(name))
                return "\"" + name.Replace("\"", "") + "\"";
        }
        catch
        {
            // Translation is best-effort; unresolvable SIDs fall through to
            // the legacy *SID form below.
        }
        return MemberSpec(userSid);
    }

    static void RunNet(string action, string userSid)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            Console.WriteLine($"[dry-run] {action} local Administrators {userSid}");
            return;
        }
        var args = action == "add"
            ? $"localgroup Administrators {MemberArg(userSid)} /add"
            : $"localgroup Administrators {MemberArg(userSid)} /delete";
        var psi = new ProcessStartInfo("net.exe", args)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi);
        if (proc is null)
        {
            BrokerLog.Write($"net.exe failed to start ({args})");
            return;
        }
        proc.WaitForExit(15_000);
        var output = (proc.StandardOutput.ReadToEnd() + " " + proc.StandardError.ReadToEnd()).Trim();
        BrokerLog.Write($"net.exe {args} exit={proc.ExitCode} {output}");
    }

    internal sealed record JitState(string grantId, string userSid, long exp);
}
