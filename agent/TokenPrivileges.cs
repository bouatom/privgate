using System.Runtime.InteropServices;

namespace PrivGate.Agent;

/// <summary>
/// Enables the privileges CreateProcessAsUser / WTSQueryUserToken need.
/// LocalSystem holds them, but they start disabled; without this the service
/// cannot launch a tray at SessionLogon and logon falls through to HKLM Run
/// (Explorer delays those entries by several seconds).
/// </summary>
static class TokenPrivileges
{
    const uint TokenAdjustPrivileges = 0x0020;
    const uint TokenQuery = 0x0008;
    const uint SePrivilegeEnabled = 0x00000002;
    static int _done;

    internal static void EnableForService()
    {
        if (Interlocked.Exchange(ref _done, 1) == 1) return;
        if (!OpenProcessToken(GetCurrentProcess(), TokenAdjustPrivileges | TokenQuery, out var token))
        {
            BrokerLog.Write($"token privileges: OpenProcessToken failed {Marshal.GetLastWin32Error()}");
            return;
        }
        try
        {
            Enable(token, "SeTcbPrivilege");
            Enable(token, "SeAssignPrimaryTokenPrivilege");
            Enable(token, "SeIncreaseQuotaPrivilege");
        }
        finally
        {
            CloseHandle(token);
        }
    }

    static void Enable(IntPtr token, string name)
    {
        if (!LookupPrivilegeValue(null, name, out var luid))
        {
            BrokerLog.Write($"token privileges: Lookup {name} failed {Marshal.GetLastWin32Error()}");
            return;
        }
        var tp = new TOKEN_PRIVILEGES
        {
            PrivilegeCount = 1,
            Privileges = new LUID_AND_ATTRIBUTES { Luid = luid, Attributes = SePrivilegeEnabled },
        };
        if (!AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
        {
            BrokerLog.Write($"token privileges: Adjust {name} failed {Marshal.GetLastWin32Error()}");
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LUID_AND_ATTRIBUTES
    {
        public LUID Luid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_PRIVILEGES
    {
        public uint PrivilegeCount;
        public LUID_AND_ATTRIBUTES Privileges;
    }

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool LookupPrivilegeValue(string? system, string name, out LUID luid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(
        IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES newState,
        uint buflen, IntPtr prev, IntPtr needed);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
}
