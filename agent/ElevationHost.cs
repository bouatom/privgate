using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace PrivGate.Agent;

public static class Authenticode
{
    public static string Sha256File(string path)
    {
        using var stream = File.OpenRead(path);
        var hash = SHA256.HashData(stream);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static string Publisher(string path)
    {
        if (!OperatingSystem.IsWindows()) return "dry-run";
        try
        {
            using var cert = X509Certificate.CreateFromSignedFile(path);
            using var wrapped = new X509Certificate2(cert);
            return wrapped.Subject;
        }
        catch
        {
            return "";
        }
    }
}

public static class ElevationHost
{
    public static int Launch(string filePath, string arguments, bool denyChildren)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException(filePath);
        if (HardBans.IsBanned(filePath) && Environment.GetEnvironmentVariable("PRIVGATE_JIT") != "1")
        {
            throw new InvalidOperationException("hard-banned binary");
        }

        if (!OperatingSystem.IsWindows())
        {
            Console.WriteLine($"[dry-run] would elevate {filePath} children={(!denyChildren ? "allow" : "deny")}");
            return 0;
        }

        var start = new ProcessStartInfo(filePath, arguments)
        {
            UseShellExecute = false,
        };
        using var proc = Process.Start(start) ?? throw new InvalidOperationException("CreateProcess failed");
        if (denyChildren)
        {
            AssignSingleProcessJob(proc);
        }
        return proc.Id;
    }

    static void AssignSingleProcessJob(Process proc)
    {
        // Job object with active process limit 1 prevents the elevated payload from spawning children.
        var job = CreateJobObject(IntPtr.Zero, $"PrivGate-{proc.Id}");
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
            {
                LimitFlags = 0x00000008 | 0x00002000, // ACTIVE_PROCESS | KILL_ON_JOB_CLOSE
                ActiveProcessLimit = 1,
            }
        };
        var len = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        var ptr = Marshal.AllocHGlobal(len);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            SetInformationJobObject(job, 9, ptr, (uint)len);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
        AssignProcessToJobObject(job, proc.Handle);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
