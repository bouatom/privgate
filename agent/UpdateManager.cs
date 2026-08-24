using System.Diagnostics;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;

namespace PrivGate.Agent;

/// <summary>
/// Applies control-plane pushed agent updates. Downloads the branded client MSI
/// from /api/agent/update/download (device-HMAC authenticated), verifies its
/// SHA-256 against the X-Update-SHA256 response header, then runs msiexec
/// silently. The MSI MajorUpgrade stops this service, replaces files, and
/// restarts it; on startup the new build re-registers/reconnects and reports
/// its version. Standard Windows Installer only — no elevation tricks.
/// </summary>
public sealed class UpdateManager
{
    public const string DownloadPath = "/api/agent/update/download";
    static readonly TimeSpan DownloadTimeout = TimeSpan.FromMinutes(10);

    readonly string apiBase;
    readonly string deviceId;
    readonly string secret;
    readonly string stateDir;
    int updateRunning;

    public UpdateManager(string apiBase, string deviceId, string secret)
    {
        this.apiBase = apiBase.TrimEnd('/');
        this.deviceId = deviceId;
        this.secret = secret;
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        if (string.IsNullOrEmpty(programData)) programData = @"C:\ProgramData";
        stateDir = Path.Combine(programData, "PrivGate", "update");
    }

    /// <summary>This build's version (assembly version, x.y.z).</summary>
    public static string AgentVersion()
    {
        var v = typeof(UpdateManager).Assembly.GetName().Version ?? new Version(0, 0, 0);
        return $"{v.Major}.{v.Minor}.{v.Build}";
    }

    /// <summary>True when pushed version is strictly newer than this build.</summary>
    public static bool IsNewer(string pushedVersion)
    {
        var current = ParseParts(AgentVersion());
        var pushed = ParseParts(pushedVersion);
        for (var i = 0; i < 3; i++)
        {
            if (pushed[i] != current[i]) return pushed[i] > current[i];
        }
        return false;
    }

    /// <summary>Entry point for an 'agent-update' push. Fire-and-forget safe.</summary>
    public void BeginUpdate(JsonElement msg)
    {
        var version = msg.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
        if (version.Length == 0 || !IsNewer(version))
        {
            Console.WriteLine($"PrivGate update: ignoring push '{version}' (installed {AgentVersion()})");
            return;
        }
        if (Interlocked.Exchange(ref updateRunning, 1) == 1) return;
        Task.Run(async () =>
        {
            try
            {
                BrokerStatus.Current.NoteNotice("PrivGate update", $"Downloading version {version}…");
                var msiPath = await DownloadAsync(ct: CancellationToken.None).ConfigureAwait(false);
                BrokerStatus.Current.NoteNotice("PrivGate update", "Installing — the service restarts in a moment.");
                RunMsiexec(msiPath);
                // msiexec stops PrivGateBroker; process exits via service stop.
            }
            catch (Exception ex)
            {
                Interlocked.Exchange(ref updateRunning, 0);
                Console.Error.WriteLine($"PrivGate update failed: {ex.Message}");
                BrokerStatus.Current.NoteNotice("PrivGate update failed", ex.Message);
            }
        });
    }

    async Task<string> DownloadAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(stateDir);
        var targetPath = Path.Combine(stateDir, "PrivGate-Client.msi");
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        byte[] rawHash;
        using (var sha256 = SHA256.Create()) { rawHash = sha256.ComputeHash(Array.Empty<byte>()); }
        var sig = TicketVerifier.DeviceHmac(secret, ts, "GET", DownloadPath, Authenticode.BytesToHex(rawHash));

        using var http = new HttpClient { Timeout = DownloadTimeout };
        using var req = new HttpRequestMessage(HttpMethod.Get, apiBase + DownloadPath);
        req.Headers.TryAddWithoutValidation("X-Device-Id", deviceId);
        req.Headers.TryAddWithoutValidation("X-Timestamp", ts);
        req.Headers.TryAddWithoutValidation("X-Signature", sig);

        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"download failed ({(int)res.StatusCode})");
        }
        var expectedSha = res.Headers.TryGetValues("X-Update-Sha256", out var values)
            ? values.FirstOrDefault() ?? ""
            : "";
        if (expectedSha.Length != 64)
        {
            throw new InvalidOperationException("server did not provide a content hash");
        }

        using (var stream = await res.Content.ReadAsStreamAsync().ConfigureAwait(false))
        using (var output = File.Create(targetPath))
        {
            await stream.CopyToAsync(output, 81920, ct).ConfigureAwait(false);
        }

        VerifySha256(targetPath, expectedSha);
        return targetPath;
    }

    static void VerifySha256(string path, string expectedHex)
    {
        byte[] bytes = Array.Empty<byte>();
        for (var attempt = 0; attempt < 8; attempt++)
        {
            try
            {
                using var sha256 = SHA256.Create();
                bytes = sha256.ComputeHash(File.ReadAllBytes(path));
                break;
            }
            catch (IOException)
            {
                Thread.Sleep(250);
            }
        }
        if (bytes.Length == 0) throw new IOException("update package could not be read");
        var hex = Authenticode.BytesToHex(bytes);
        if (!string.Equals(hex, expectedHex, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("update package failed integrity check");
        }
    }

    static void RunMsiexec(string msiPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "msiexec.exe"),
            Arguments = $"/i \"{msiPath}\" /qn /norestart",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Console.WriteLine($"PrivGate update: launching {psi.FileName} {psi.Arguments}");
        Process.Start(psi);
    }

    static int[] ParseParts(string version)
    {
        var parts = new[] { 0, 0, 0 };
        var cleaned = version.TrimStart('v', 'V').Split('-', '+')[0];
        var segments = cleaned.Split('.');
        for (var i = 0; i < parts.Length && i < segments.Length; i++)
        {
            int.TryParse(segments[i], out parts[i]);
        }
        return parts;
    }
}
