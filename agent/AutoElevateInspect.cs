using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace PrivGate.Agent;

/// <summary>
/// Fully-guarded Win32 reads for the auto-elevate watcher. Never throws;
/// any failure degrades to "do not act".
/// </summary>
static class AutoElevateInspect
{
    const uint QueryLimited = 0x1000;
    const uint TokenQuery = 0x0008;
    const int TokenUserClass = 1;
    const int TokenIntegrityLevel = 25;
    internal const int MediumIntegrityRid = 0x2000;

    internal static string ImagePath(int pid)
    {
        var hProc = OpenProcess(QueryLimited, false, (uint)pid);
        if (hProc == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(1024);
            uint size = (uint)sb.Capacity;
            if (!QueryFullProcessImageName(hProc, 0, sb, ref size)) return "";
            return sb.ToString();
        }
        catch
        {
            return "";
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    internal static bool TryInspect(int pid, out string userSid, out int integrityRid)
    {
        userSid = "";
        integrityRid = -1;
        var hProc = OpenProcess(QueryLimited, false, (uint)pid);
        if (hProc == IntPtr.Zero) return false;
        try
        {
            if (!OpenProcessToken(hProc, TokenQuery, out var hTok)) return false;
            try
            {
                userSid = TokenUserSid(hTok);
                integrityRid = IntegrityRid(hTok);
                return userSid.Length > 0 && integrityRid >= 0;
            }
            finally
            {
                CloseHandle(hTok);
            }
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

    internal static bool IsServiceSid(string sid)
    {
        if (string.IsNullOrWhiteSpace(sid)) return true;
        try
        {
            var parsed = new SecurityIdentifier(sid);
            return parsed.IsWellKnown(WellKnownSidType.LocalSystemSid)
                || parsed.IsWellKnown(WellKnownSidType.LocalServiceSid)
                || parsed.IsWellKnown(WellKnownSidType.NetworkServiceSid);
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// Interactive user's SID for a session, via the logon token (SYSTEM-only).
    /// Used when the candidate process itself is LocalSystem (consent.exe).
    /// </summary>
    internal static string SessionUserSid(int sessionId)
    {
        if (sessionId <= 0) return "";
        if (!WTSQueryUserToken((uint)sessionId, out var token)) return "";
        try
        {
            return TokenUserSid(token);
        }
        catch
        {
            return "";
        }
        finally
        {
            CloseHandle(token);
        }
    }

    internal static string RemainingArgs(string commandLine)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return "";
        try
        {
            var argv = UacTargetCache.Native.SplitArgs(commandLine);
            if (argv.Length <= 1) return "";
            var parts = new string[argv.Length - 1];
            for (var i = 1; i < argv.Length; i++)
            {
                var a = argv[i] ?? "";
                parts[i - 1] = NeedsQuotes(a) ? "\"" + a.Replace("\"", "\\\"") + "\"" : a;
            }
            return string.Join(" ", parts);
        }
        catch
        {
            return "";
        }
    }

    static bool NeedsQuotes(string a) =>
        a.Length == 0 || a.IndexOfAny(new[] { ' ', '\t', '"' }) >= 0;

    static int IntegrityRid(IntPtr token)
    {
        GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out var needed);
        if (needed == 0) return -1;
        var buf = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!GetTokenInformation(token, TokenIntegrityLevel, buf, needed, out _)) return -1;
            var sidPtr = Marshal.ReadIntPtr(buf);
            if (sidPtr == IntPtr.Zero) return -1;
            var countPtr = GetSidSubAuthorityCount(sidPtr);
            if (countPtr == IntPtr.Zero) return -1;
            var count = Marshal.ReadByte(countPtr);
            if (count == 0) return -1;
            var ridPtr = GetSidSubAuthority(sidPtr, count - 1);
            if (ridPtr == IntPtr.Zero) return -1;
            return Marshal.ReadInt32(ridPtr);
        }
        catch
        {
            return -1;
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
    }

    static string TokenUserSid(IntPtr token)
    {
        GetTokenInformation(token, TokenUserClass, IntPtr.Zero, 0, out var needed);
        if (needed == 0) return "";
        var buf = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!GetTokenInformation(token, TokenUserClass, buf, needed, out _)) return "";
            var sidPtr = Marshal.ReadIntPtr(buf);
            if (sidPtr == IntPtr.Zero) return "";
            return new SecurityIdentifier(sidPtr).Value;
        }
        catch
        {
            return "";
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(
        IntPtr token, int infoClass, IntPtr info, uint infoLength, out uint returnedLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern IntPtr GetSidSubAuthority(IntPtr sid, int index);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder text, ref uint size);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);
}
