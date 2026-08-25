using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace PrivGate.Agent;

/// <summary>
/// What actually happened when the stock-UAC (consent.exe) prompt closed.
/// Wire names mirror the console whitelist in <c>src/lib/realtime/rpc.ts</c>.
/// </summary>
enum UacOutcome
{
    ApprovedSelf,
    ApprovedOther,
    Escaped,
    Timeout,
    Unknown,
}

/// <summary>
/// Classifies a just-closed consent.exe prompt by reading tokens of running
/// processes. Runs ONLY inside the broker service (LOCAL SYSTEM): the medium-IL
/// tray is routinely denied OpenProcessToken on high-IL processes, while SYSTEM
/// succeeds — that asymmetry is the whole point of classifying here (see
/// docs/research/audit-first-plan.md §1). Purely passive userland reads: no
/// hooks, no token manipulation, nothing AGENTS.md forbids.
/// </summary>
static class UacClassifier
{
    const uint QueryLimitedInformation = 0x1000;
    const uint TokenQuery = 0x0008;
    const int TokenUserClass = 1;
    const int TokenElevationTypeClass = 18;
    const int ElevationTypeFull = 2;

    // The elevated child starts roughly as consent.exe exits, so a single
    // snapshot races the spawn: poll briefly inside the service. The tray's
    // pipe read timeout (ElevationClient.ClassifyClosedPrompt) covers slightly
    // more than this window so the reply always beats the client giving up.
    const int WindowMs = 4500;
    const int PollMs = 350;

    // A matching elevated process older than this is a pre-existing instance,
    // not the child spawned by the prompt we just saw (guards against scoring
    // a stale elevated twin when the user actually canceled).
    const int MaxChildAgeMinutes = 2;

    /// <summary>Canonical wire strings shared with the server-side whitelist.</summary>
    internal static string Wire(UacOutcome outcome)
    {
        switch (outcome)
        {
            case UacOutcome.ApprovedSelf: return "approved-self";
            case UacOutcome.ApprovedOther: return "approved-other";
            case UacOutcome.Escaped: return "escaped";
            case UacOutcome.Timeout: return "timeout";
            default: return "unknown";
        }
    }

    /// <summary>Parses a wire string; anything unrecognized is Unknown.</summary>
    internal static UacOutcome ParseWire(string value)
    {
        switch ((value ?? "").Trim())
        {
            case "approved-self": return UacOutcome.ApprovedSelf;
            case "approved-other": return UacOutcome.ApprovedOther;
            case "escaped": return UacOutcome.Escaped;
            case "timeout": return UacOutcome.Timeout;
            default: return UacOutcome.Unknown;
        }
    }

    /// <summary>
    /// Decide what happened to the prompt that just closed. Every Win32 call is
    /// guarded; any failure degrades toward Unknown and this never throws.
    /// Timeout folds into Escaped while undetectable (the wire value exists for
    /// a future visibility-duration heuristic).
    /// </summary>
    internal static UacOutcome Classify(string interactiveUserSid, string candidatePath, int sessionId)
    {
        try
        {
            // Without a usable identity pair attribution is dishonest: an empty
            // target name would match every process on the box, and an empty
            // SID would make every elevated child look like other-creds.
            var targetName = TargetFileName(candidatePath);
            if (targetName.Length == 0 || string.IsNullOrWhiteSpace(interactiveUserSid))
            {
                return UacOutcome.Unknown;
            }

            var deadline = DateTime.UtcNow.AddMilliseconds(WindowMs);
            var inspectedAnyToken = false;
            var selfPid = Process.GetCurrentProcess().Id;
            while (true)
            {
                var hit = ScanOnce(
                    interactiveUserSid.Trim(), targetName, sessionId, selfPid, ref inspectedAnyToken);
                if (hit != UacOutcome.Escaped) return hit;
                if (DateTime.UtcNow >= deadline)
                {
                    // Nothing elevated qualified during the window. Honest label
                    // is Escaped — unless we could never read a single token, in
                    // which case we simply do not know.
                    return inspectedAnyToken ? UacOutcome.Escaped : UacOutcome.Unknown;
                }
                System.Threading.Thread.Sleep(PollMs);
            }
        }
        catch
        {
            return UacOutcome.Unknown;
        }
    }

    /// <summary>
    /// One pass over the process list. Returns the final verdict when a
    /// qualifying elevated child (or an inconclusive candidate) is found;
    /// Escaped means "nothing qualified in this pass".
    /// </summary>
    static UacOutcome ScanOnce(string userSid, string targetName, int sessionId, int selfPid, ref bool inspectedAnyToken)
    {
        foreach (var proc in Process.GetProcesses())
        {
            try
            {
                if (proc.Id <= 4 || proc.Id == selfPid) continue;
                if (sessionId > 0 && SafeSessionId(proc) != sessionId) continue;
                if (!IsTargetImage(proc.Id, targetName)) continue;
                // A long-running elevated instance of the same image predates
                // this prompt; treating it as the child would mislabel a real
                // cancel as approved-*. Only fresh processes qualify.
                if (!StartedRecently(proc)) continue;
                var verdict = InspectToken(proc.Id, userSid, out var openedToken);
                if (openedToken) inspectedAnyToken = true;
                if (verdict == null || verdict.Value == UacOutcome.Escaped) continue;
                return verdict.Value;
            }
            catch
            {
                // Process exited mid-scan or denied a query: skip it.
            }
            finally
            {
                proc.Dispose();
            }
        }
        return UacOutcome.Escaped;
    }

    static int SafeSessionId(Process proc)
    {
        try { return proc.SessionId; }
        catch { return -1; }
    }

    /// <summary>
    /// True when the process started inside the freshness window. Unreadable
    /// start times (rare under SYSTEM) count as fresh so we still classify.
    /// </summary>
    static bool StartedRecently(Process proc)
    {
        try
        {
            return DateTime.UtcNow - proc.StartTime.ToUniversalTime() <= TimeSpan.FromMinutes(MaxChildAgeMinutes);
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// Token inspection of one candidate. null = could not open the process or
    /// token (keep polling); Escaped = token readable but not elevated; the
    /// rest are final classifications.
    /// </summary>
    static UacOutcome? InspectToken(int pid, string userSid, out bool tokenOpened)
    {
        tokenOpened = false;
        var hProc = OpenProcess(QueryLimitedInformation, false, (uint)pid);
        if (hProc == IntPtr.Zero) return null;
        try
        {
            if (!OpenProcessToken(hProc, TokenQuery, out var hTok)) return null;
            tokenOpened = true;
            try
            {
                if (!TryGetElevationType(hTok, out var elevation) || elevation != ElevationTypeFull)
                {
                    return UacOutcome.Escaped;
                }
                var sid = TokenUserSidString(hTok);
                if (sid.Length == 0) return UacOutcome.Unknown;
                return sid.Equals(userSid, StringComparison.OrdinalIgnoreCase)
                    ? UacOutcome.ApprovedSelf
                    : UacOutcome.ApprovedOther;
            }
            finally
            {
                CloseHandle(hTok);
            }
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    static string TargetFileName(string candidatePath)
    {
        try
        {
            return System.IO.Path.GetFileName((candidatePath ?? "").Trim()).ToLowerInvariant();
        }
        catch
        {
            return "";
        }
    }

    /// <summary>Cross-integrity image-name match via the limited-info handle.</summary>
    static bool IsTargetImage(int pid, string targetName)
    {
        if (targetName.Length == 0) return false;
        var hProc = OpenProcess(QueryLimitedInformation, false, (uint)pid);
        if (hProc == IntPtr.Zero) return false;
        try
        {
            var sb = new StringBuilder(1024);
            uint size = (uint)sb.Capacity;
            if (!QueryFullProcessImageName(hProc, 0, sb, ref size)) return false;
            var name = System.IO.Path.GetFileName(sb.ToString());
            return name.Equals(targetName, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    static bool TryGetElevationType(IntPtr token, out int elevationType)
    {
        elevationType = 0;
        if (!GetTokenInformation(token, TokenElevationTypeClass, IntPtr.Zero, 0, out var needed) || needed == 0)
        {
            return false;
        }
        var buf = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!GetTokenInformation(token, TokenElevationTypeClass, buf, needed, out _)) return false;
            elevationType = Marshal.ReadInt32(buf);
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
    }

    static string TokenUserSidString(IntPtr token)
    {
        if (!GetTokenInformation(token, TokenUserClass, IntPtr.Zero, 0, out var needed) || needed == 0)
        {
            return "";
        }
        var buf = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!GetTokenInformation(token, TokenUserClass, buf, needed, out _)) return "";
            var sidPtr = Marshal.ReadIntPtr(buf); // TOKEN_USER begins with SID_AND_ATTRIBUTES.Sid
            if (sidPtr == IntPtr.Zero || !ConvertSidToStringSid(sidPtr, out var strPtr)) return "";
            try
            {
                return Marshal.PtrToStringAuto(strPtr) ?? "";
            }
            finally
            {
                LocalFree(strPtr);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
    }

    // --- Win32. All classifier P/Invoke lives in this one file by convention. ---

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(
        IntPtr token, int infoClass, IntPtr info, uint infoLength, out uint returnedLength);

    [DllImport("advapi32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr stringSid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr LocalFree(IntPtr mem);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder text, ref uint size);
}
