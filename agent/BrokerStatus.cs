using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace PrivGate.Agent;

public sealed class StatusRequest
{
    public string At { get; set; } = "";
    public string Path { get; set; } = "";
    public string Decision { get; set; } = "";
}

public sealed class StatusSnapshot
{
    public string DeviceId { get; set; } = "";
    public string Hostname { get; set; } = Environment.MachineName;
    public string ApiBase { get; set; } = "";
    public bool Realtime { get; set; }
    public string StartedAt { get; set; } = "";
    public string? ConnectedAt { get; set; }
    public int Reconnects { get; set; }
    public string LastError { get; set; } = "";
    public string Source { get; set; } = "";
    public bool JitActive { get; set; }
    public string? JitUntil { get; set; }
    public string Pending { get; set; } = "";
    public string NoticeTitle { get; set; } = "";
    public string NoticeBody { get; set; } = "";
    public int NoticeSeq { get; set; }
    public StatusRequest[] Requests { get; set; } = Array.Empty<StatusRequest>();
}

/// <summary>Live broker snapshot for the tray UI and named-pipe status RPC.</summary>
public sealed class BrokerStatus
{
    public static BrokerStatus Current { get; } = new();

    static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    readonly ConcurrentQueue<StatusRequest> _requests = new();
    readonly object _gate = new();
    string _deviceId = "";
    string _apiBase = "";
    bool _realtime;
    DateTimeOffset _startedAt = DateTimeOffset.Now;
    DateTimeOffset? _connectedAt;
    int _reconnects;
    string _lastError = "";
    bool _jitActive;
    string? _jitUntil;
    string _noticeTitle = "";
    string _noticeBody = "";
    int _noticeSeq;
    string _pending = "";

    public void Configure(string deviceId, string apiBase)
    {
        lock (_gate)
        {
            _deviceId = deviceId;
            _apiBase = apiBase;
            _startedAt = DateTimeOffset.Now;
        }
    }

    public void MarkConnected()
    {
        lock (_gate)
        {
            _realtime = true;
            _connectedAt = DateTimeOffset.Now;
            _lastError = "";
        }
    }

    public void MarkDisconnected(string reason)
    {
        lock (_gate)
        {
            if (_realtime) _reconnects++;
            _realtime = false;
            _connectedAt = null;
            _lastError = reason ?? "";
        }
    }

    public void NoteRequest(string path, string decision)
    {
        _requests.Enqueue(new StatusRequest
        {
            At = DateTimeOffset.Now.ToString("HH:mm:ss"),
            Path = path,
            Decision = decision,
        });
        while (_requests.Count > 12 && _requests.TryDequeue(out _)) { }
    }

    public void NoteJit(bool active, DateTimeOffset? until = null)
    {
        lock (_gate)
        {
            _jitActive = active;
            _jitUntil = until?.ToLocalTime().ToString("g");
            if (!active) _jitUntil = null;
        }
    }

    public void NotePending(string? text)
    {
        lock (_gate) { _pending = text ?? ""; }
    }

    public void NoteNotice(string title, string body)
    {
        lock (_gate)
        {
            _noticeTitle = title;
            _noticeBody = body;
            _noticeSeq++;
        }
    }

    public StatusSnapshot Snapshot(string source = "in-process")
    {
        lock (_gate)
        {
            return new StatusSnapshot
            {
                DeviceId = _deviceId,
                Hostname = Environment.MachineName,
                ApiBase = _apiBase,
                Realtime = _realtime,
                StartedAt = _startedAt.ToString("u"),
                ConnectedAt = _connectedAt?.ToString("u"),
                Reconnects = _reconnects,
                LastError = _lastError,
                Source = source,
                JitActive = _jitActive,
                JitUntil = _jitUntil,
                Pending = _pending,
                NoticeTitle = _noticeTitle,
                NoticeBody = _noticeBody,
                NoticeSeq = _noticeSeq,
                Requests = _requests.ToArray(),
            };
        }
    }

    public string ToJson() => JsonSerializer.Serialize(Snapshot("service"), JsonOpts);

    public static StatusSnapshot? TryQueryPipe(int timeoutMs = 800)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", NamedPipeHost.PipeName, PipeDirection.InOut);
            pipe.Connect(timeoutMs);
            using var writer = new StreamWriter(pipe, Encoding.UTF8, 4096, leaveOpen: true) { AutoFlush = true };
            using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
            writer.WriteLine(JsonSerializer.Serialize(new { mode = "status" }));
            var line = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(line)) return null;
            return JsonSerializer.Deserialize<StatusSnapshot>(line, JsonOpts);
        }
        catch
        {
            return null;
        }
    }
}
