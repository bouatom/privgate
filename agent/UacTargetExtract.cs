using System.Diagnostics;
using System.Text.RegularExpressions;

namespace PrivGate.Agent;

/// <summary>
/// Turns a process command line into the program Windows asked about.
/// Consent.exe itself only carries AppInfo pointers; the caller (for example
/// PowerShell Start-Process -Verb RunAs) still has the .msc/.exe path.
/// </summary>
static class UacTargetExtract
{
    static readonly HashSet<string> Wrappers = new(StringComparer.OrdinalIgnoreCase)
    {
        "powershell.exe", "pwsh.exe", "cmd.exe", "conhost.exe", "consent.exe", "explorer.exe",
    };

    static readonly HashSet<string> Launchers = new(StringComparer.OrdinalIgnoreCase)
    {
        "powershell", "pwsh", "cmd", "mmc", "msiexec", "wscript", "cscript",
    };

    static readonly Regex EmbeddedPath = new(
        @"[A-Za-z]:\\(?:[^<>:""/|?*\r\n]+\\)*[^<>:""/|?*\r\n]+\.(?:exe|msc|msi)|\\\\[^<>:""/|?*\r\n]+\\[^<>:""/|?*\r\n]+\.(?:exe|msc|msi)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>
    /// Picks the program path out of a command line. Prefers an existing
    /// .msc/.msi over the host EXE and skips shell wrappers.
    /// </summary>
    internal static string ExtractTarget(string commandLine)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return "";
        var candidates = new List<string>();
        foreach (var arg in UacTargetCache.Native.SplitArgs(commandLine).Skip(1))
            Consider(candidates, arg.Trim().Trim('"'));
        if (candidates.Count == 0) CollectEmbedded(commandLine, candidates);
        return PreferTarget(candidates);
    }

    /// <summary>
    /// When consent.exe has no path in argv, look at other processes in the
    /// same session that started around the prompt (typical: powershell -Verb
    /// RunAs). Does not read, hook, or dismiss the secure desktop.
    /// </summary>
    internal static string FromSession(int sessionId, int consentPid)
    {
        if (sessionId <= 0) return "";
        DateTime consentStart;
        try { consentStart = Process.GetProcessById(consentPid).StartTime; }
        catch { return ""; }
        var earliest = consentStart.AddSeconds(-90);
        var latest = consentStart.AddSeconds(5);
        var runAs = new List<string>();
        var other = new List<string>();
        Process[] procs;
        try { procs = Process.GetProcesses(); }
        catch { return ""; }
        try
        {
            foreach (var proc in procs)
            {
                try
                {
                    if (proc.Id == consentPid || proc.SessionId != sessionId) continue;
                    if (!Launchers.Contains(proc.ProcessName)) continue;
                    DateTime started;
                    try { started = proc.StartTime; }
                    catch { continue; }
                    if (started < earliest || started > latest) continue;
                    var line = UacTargetCache.Native.CommandLineOf(proc.Id);
                    if (line.Length == 0) continue;
                    var hit = ExtractTarget(line);
                    if (hit.Length == 0) continue;
                    if (line.IndexOf("RunAs", StringComparison.OrdinalIgnoreCase) >= 0)
                        runAs.Add(hit);
                    else
                        other.Add(hit);
                }
                catch
                {
                    // Process exited while we inspected it.
                }
            }
        }
        finally
        {
            foreach (var p in procs)
            {
                try { p.Dispose(); } catch { /* already gone */ }
            }
        }
        if (runAs.Count > 0) return PreferTarget(runAs);
        return PreferTarget(other);
    }

    /// <summary>Prefers snap-ins/installers, then non-wrapper EXEs.</summary>
    internal static string PreferTarget(IReadOnlyList<string> candidates)
    {
        if (candidates.Count == 0) return "";
        foreach (var c in candidates)
        {
            var lower = c.ToLowerInvariant();
            if (lower.EndsWith(".msc") || lower.EndsWith(".msi")) return c;
        }
        foreach (var c in candidates)
        {
            if (!Wrappers.Contains(Path.GetFileName(c))) return c;
        }
        return candidates[0];
    }

    static void CollectEmbedded(string commandLine, List<string> candidates)
    {
        foreach (Match match in EmbeddedPath.Matches(commandLine))
            Consider(candidates, match.Value);
    }

    static void Consider(List<string> candidates, string candidate)
    {
        if (candidate.Length < 4) return;
        if (!(candidate.Contains(':') || candidate.StartsWith("\\\\"))) return;
        var lower = candidate.ToLowerInvariant();
        if (!(lower.EndsWith(".exe") || lower.EndsWith(".msc") || lower.EndsWith(".msi"))) return;
        if (!File.Exists(candidate)) return;
        if (!candidates.Contains(candidate)) candidates.Add(candidate);
    }
}
