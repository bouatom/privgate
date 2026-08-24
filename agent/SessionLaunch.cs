using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace PrivGate.Agent;

/// <summary>
/// Starts an allowed payload on the interactive desktop. Session-0 SYSTEM
/// CreateProcess is invisible to the logged-on user (session isolation).
/// This duplicates the service token, sets TokenSessionId, and uses
/// CreateProcessAsUser — it does not mint an admin token for the user.
/// </summary>
static class SessionLaunch
{
    const uint TokenAssignPrimary = 0x0001;
    const uint TokenDuplicate = 0x0002;
    const uint TokenQuery = 0x0008;
    const uint TokenAdjustDefault = 0x0080;
    const uint TokenAdjustSessionId = 0x0100;
    const int SecurityImpersonation = 2;
    const int TokenPrimary = 1;
    const int TokenSessionId = 12;
    const uint CreateUnicodeEnvironment = 0x00000400;
    const uint CreateNewConsole = 0x00000010;
    const uint StartfUseShowWindow = 0x00000001;
    const short SwShownormal = 1;

    internal static Process? InSession(int sessionId, string filePath, string arguments)
    {
        if (sessionId <= 0) return null;
        if (!OpenProcessToken(Process.GetCurrentProcess().Handle,
                TokenDuplicate | TokenQuery, out var existing))
        {
            BrokerLog.Write($"OpenProcessToken failed {Marshal.GetLastWin32Error()}");
            return null;
        }
        try
        {
            var access = TokenAssignPrimary | TokenDuplicate | TokenQuery | TokenAdjustDefault | TokenAdjustSessionId;
            if (!DuplicateTokenEx(existing, access, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out var dup))
            {
                BrokerLog.Write($"DuplicateTokenEx failed {Marshal.GetLastWin32Error()}");
                return null;
            }
            try
            {
                var sid = sessionId;
                if (!SetTokenInformation(dup, TokenSessionId, ref sid, sizeof(int)))
                {
                    BrokerLog.Write($"SetTokenInformation session failed {Marshal.GetLastWin32Error()}");
                    return null;
                }
                var command = Quote(filePath) + (string.IsNullOrWhiteSpace(arguments) ? "" : " " + arguments);
                var start = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFO>(),
                    lpDesktop = @"winsta0\default",
                    dwFlags = StartfUseShowWindow,
                    wShowWindow = SwShownormal,
                };
                CreateEnvironmentBlock(out var env, dup, false);
                try
                {
                    var flags = CreateUnicodeEnvironment | CreateNewConsole;
                    if (!CreateProcessAsUser(dup, null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero,
                            false, flags, env, Path.GetDirectoryName(filePath), ref start, out var info))
                    {
                        BrokerLog.Write($"CreateProcessAsUser failed {Marshal.GetLastWin32Error()} cmd={command}");
                        return null;
                    }
                    CloseHandle(info.hThread);
                    CloseHandle(info.hProcess);
                    BrokerLog.Write($"launched in session {sessionId} pid={info.dwProcessId} {filePath}");
                    try { return Process.GetProcessById(info.dwProcessId); }
                    catch { return null; }
                }
                finally
                {
                    if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
                }
            }
            finally { CloseHandle(dup); }
        }
        finally { CloseHandle(existing); }
    }

    static string Quote(string path) => path.StartsWith("\"", StringComparison.Ordinal) ? path : "\"" + path + "\"";

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool DuplicateTokenEx(IntPtr existing, uint access, IntPtr sa, int impersonation, int type, out IntPtr dup);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr token, int cls, ref int data, int size);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool DestroyEnvironmentBlock(IntPtr env);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(
        IntPtr token, string? app, StringBuilder cmd, IntPtr pa, IntPtr ta,
        bool inherit, uint flags, IntPtr env, string? dir, ref STARTUPINFO start, out PROCESS_INFORMATION info);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }
}
