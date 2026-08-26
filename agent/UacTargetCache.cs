using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace PrivGate.Agent;

/// <summary>
/// Remembers what program each stock-UAC prompt was for, captured while the
/// prompt is still open. Windows launches <c>consent.exe</c> with the target
/// program path inside its command line; the broker (SYSTEM) reads that line
/// natively — no WMI dependency, no hooking, no touching the secure desktop —
/// and only trusts PIDs whose owner is LocalSystem, so a lookalike process in
/// the user's session cannot poison the cache. The cached path merely
/// pre-fills the request review window; every elevation still passes policy
/// evaluation, ticket verification and hard-bans.
/// </summary>
public static class UacTargetCache
{
    record Entry(string Target, DateTimeOffset Seen);

    static readonly ConcurrentDictionary<int, Entry> ByPid = new();
    static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(120);

    /// <summary>
    /// Snapshots the targets for the given session consent PIDs. Best-effort:
    /// missing, exited, or foreign-owner PIDs are simply skipped. Returns the
    /// distinct targets discovered during this call, in pid order, so the
    /// caller can echo them straight back to the tray.
    /// </summary>
    public static IReadOnlyList<string> Remember(IReadOnlyCollection<int> pids)
    {
        var found = new List<string>();
        foreach (var pid in pids)
        {
            try
            {
                if (ByPid.ContainsKey(pid)) continue;
                if (!IsOwnedBySystem(pid)) continue;
                var line = Native.CommandLineOf(pid);
                var target = ExtractTarget(line);
                if (target.Length == 0) continue;
                ByPid[pid] = new Entry(target, DateTimeOffset.UtcNow);
                if (!found.Contains(target)) found.Add(target);
            }
            catch
            {
                // A dead or protected PID is not interesting; keep going.
            }
        }
        Prune();
        return found;
    }

    /// <summary>
    /// Newest remembered target among the given PIDs (typically the PIDs the
    /// tray watched seconds ago). Empty string when nothing fresh matches.
    /// </summary>
    public static string FreshTarget(IReadOnlyCollection<int> pids)
    {
        var cutoff = DateTimeOffset.UtcNow - FreshFor;
        string best = "";
        var newest = DateTimeOffset.MinValue;
        foreach (var pid in pids)
        {
            if (!ByPid.TryGetValue(pid, out var e) || e.Seen < cutoff) continue;
            if (e.Seen > newest)
            {
                newest = e.Seen;
                best = e.Target;
            }
        }
        return best;
    }

    static void Prune()
    {
        var cutoff = DateTimeOffset.UtcNow - FreshFor;
        foreach (var kv in ByPid)
        {
            if (kv.Value.Seen < cutoff) ByPid.TryRemove(kv.Key, out _);
        }
    }

    static bool IsOwnedBySystem(int pid)
    {
        var proc = Native.OpenProcess(Native.QueryLimited | Native.VmRead, false, pid);
        if (proc == IntPtr.Zero) return false;
        try
        {
            if (!Native.OpenProcessToken(proc, Native.TokenQuery, out var token)) return false;
            try
            {
                Native.GetTokenInformation(token, 1 /* TokenUser */, IntPtr.Zero, 0, out var needed);
                if (needed == 0) return false;
                var buf = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!Native.GetTokenInformation(token, 1, buf, needed, out _)) return false;
                    var sidPtr = Marshal.ReadIntPtr(buf);
                    var sid = new SecurityIdentifier(sidPtr);
                    return sid.IsWellKnown(WellKnownSidType.LocalSystemSid);
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
            finally
            {
                Native.CloseHandle(token);
            }
        }
        finally
        {
            Native.CloseHandle(proc);
        }
    }

    /// <summary>
    /// Picks the program path out of a consent.exe command line: the first
    /// quoted-or-bare argument after the executable itself that names an
    /// existing .exe/.msc/.msi file.
    /// </summary>
    internal static string ExtractTarget(string commandLine)
    {
        if (string.IsNullOrWhiteSpace(commandLine)) return "";
        var argv = Native.SplitArgs(commandLine);
        foreach (var arg in argv.Skip(1))
        {
            var candidate = arg.Trim().Trim('"');
            if (candidate.Length < 4) continue;
            if (!(candidate.Contains(':') || candidate.StartsWith("\\\\"))) continue;
            var lower = candidate.ToLowerInvariant();
            if (!(lower.EndsWith(".exe") || lower.EndsWith(".msc") || lower.EndsWith(".msi"))) continue;
            if (File.Exists(candidate)) return candidate;
        }
        return "";
    }

    /// <summary>Native helpers shared by owner check and cmdline read.</summary>
    internal static class Native
    {
        internal const uint QueryLimited = 0x1000;
        internal const uint VmRead = 0x0010;
        internal const uint TokenQuery = 0x0008;

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool GetTokenInformation(
            IntPtr token, int cls, IntPtr info, uint len, out uint returned);

        [DllImport("kernel32.dll")]
        internal static extern bool CloseHandle(IntPtr handle);

        [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        internal static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string cmd, out int argc);

        // x64 only: PEB.ProcessParameters sits at 0x20, CommandLine UNICODE_STRING at 0x70.
        const int PebParamsOffset64 = 0x20;
        const int ParamsCommandLineOffset64 = 0x70;
        const uint ProcessBasicInformation = 0;

        [StructLayout(LayoutKind.Sequential)]
        struct BasicInfo
        {
            public IntPtr Reserved1;
            public IntPtr PebBaseAddress;
            public IntPtr Reserved2a;
            public IntPtr Reserved2b;
            public IntPtr UniquePid;
            public IntPtr InheritedFromUniquePid;
        }

        [DllImport("ntdll.dll")]
        static extern int NtQueryInformationProcess(
            IntPtr proc, uint cls, ref BasicInfo info, int len, out int returned);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool ReadProcessMemory(
            IntPtr proc, IntPtr baseAddr, byte[] buffer, IntPtr size, out IntPtr read);

        /// <summary>Reads another process's full command line, x64 targets.</summary>
        internal static string CommandLineOf(int pid)
        {
            if (Environment.Is64BitProcess == false || !Environment.Is64BitOperatingSystem) return "";
            var proc = OpenProcess(QueryLimited | VmRead, false, pid);
            if (proc == IntPtr.Zero) return "";
            try
            {
                var bi = new BasicInfo();
                if (NtQueryInformationProcess(proc, ProcessBasicInformation, ref bi,
                        Marshal.SizeOf<BasicInfo>(), out _) != 0) return "";
                if (bi.PebBaseAddress == IntPtr.Zero) return "";

                var paramsBase = ReadPointer(proc, bi.PebBaseAddress + PebParamsOffset64);
                if (paramsBase == IntPtr.Zero) return "";

                // UNICODE_STRING { ushort Length; ushort MaximumLength; pad; IntPtr Buffer; }
                var us = new byte[16];
                if (!ReadProcessMemory(proc, paramsBase + ParamsCommandLineOffset64,
                        us, (IntPtr)us.Length, out _) || us.Length != 16) return "";
                var len = BitConverter.ToUInt16(us, 0);
                var bufPtr = (IntPtr)BitConverter.ToInt64(us, 8);
                if (len <= 2 || len > 2048 || bufPtr == IntPtr.Zero) return "";

                var bytes = new byte[len];
                if (!ReadProcessMemory(proc, bufPtr, bytes, (IntPtr)len, out _)) return "";
                return Encoding.Unicode.GetString(bytes);
            }
            finally
            {
                CloseHandle(proc);
            }
        }

        static IntPtr ReadPointer(IntPtr proc, IntPtr addr)
        {
            var buf = new byte[8];
            if (!ReadProcessMemory(proc, addr, buf, (IntPtr)8, out _)) return IntPtr.Zero;
            return (IntPtr)BitConverter.ToInt64(buf, 0);
        }

        internal static string[] SplitArgs(string commandLine)
        {
            var argvPtr = CommandLineToArgvW(commandLine, out var argc);
            if (argvPtr == IntPtr.Zero) return Array.Empty<string>();
            var result = new string[argc];
            try
            {
                for (var i = 0; i < argc; i++)
                {
                    var ptr = Marshal.ReadIntPtr(argvPtr + i * IntPtr.Size);
                    result[i] = Marshal.PtrToStringUni(ptr) ?? "";
                }
                return result;
            }
            finally
            {
                LocalFree(argvPtr);
            }
        }

        [DllImport("kernel32.dll")]
        static extern IntPtr LocalFree(IntPtr mem);
    }
}
