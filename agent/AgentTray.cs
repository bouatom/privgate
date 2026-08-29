using System.Drawing;
using System.ServiceProcess;
using System.Windows.Forms;

namespace PrivGate.Agent;

sealed class AgentTrayContext : ApplicationContext
{
    readonly NotifyIcon _icon;
    readonly AgentStatusForm _form;
    readonly System.Windows.Forms.Timer _timer;
    readonly System.Windows.Forms.Timer _consentTimer;
    readonly string[] _args;
    readonly CancellationTokenSource _cts = new();
    readonly bool _ownsBroker;
    int _seenNotice;

    public AgentTrayContext(string[] args)
    {
        _args = args;
        var existing = BrokerStatus.TryQueryPipe();
        // If the Windows service is installed, communication must stay in
        // Session 0. An in-process broker here dies when this user logs off
        // and takes every other session offline with it.
        _ownsBroker = existing == null && !ServiceInstalled();
        if (_ownsBroker)
        {
            _ = Task.Run(() => BrokerHost.RunAsync(_args, _cts.Token));
        }
        else if (ServiceInstalled() && !ServiceIsRunning())
        {
            TryStartService();
        }

        _form = new AgentStatusForm();
        _icon = new NotifyIcon
        {
            // Brand tile instead of SystemIcons.Shield; sized for the device
            // DPI (96 DPI → 16px) so higher-scale sessions get a sharper tray.
            Icon = AppIcon.Create(TrayPx()),
            Visible = true,
            Text = "PrivGate Agent",
            ContextMenuStrip = BuildMenu(),
        };
        _icon.DoubleClick += (_, _) => ShowStatus();
        _timer = new System.Windows.Forms.Timer { Interval = 1500 };
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        // Consent watching runs on its own fast timer: a UAC prompt that is
        // cancelled must produce the PrivGate review window in well under a
        // second, before the user forgets what they were elevating. Both
        // timers fire on the UI thread, so they never interleave.
        _consentTimer = new System.Windows.Forms.Timer { Interval = 300 };
        _consentTimer.Tick += (_, _) => ElevationPrompt.TickConsent();
        _consentTimer.Start();
        Refresh();
        Heartbeat.Start();
        if (_seenNotice == 0)
        {
            Balloon(
                "PrivGate is running",
                "Look for the shield near the clock. Right-click it to submit a request or see JIT and approval status.");
        }
    }

    ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Status", null, (_, _) => ShowStatus());
        menu.Items.Add("Request a program…", null, (_, _) => RequestProgram());
        menu.Items.Add("Open log", null, (_, _) => OpenLog());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        return menu;
    }

    void ShowStatus()
    {
        _form.Show();
        _form.WindowState = FormWindowState.Normal;
        _form.Activate();
    }

    void RequestProgram()
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Choose a program to request through PrivGate",
            Filter = "Programs and snap-ins (*.exe;*.msc;*.msi)|*.exe;*.msc;*.msi|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (dlg.ShowDialog() != DialogResult.OK) return;
        // Review step: the submitter sees exactly what they are elevating
        // (name, publisher, version, path, SHA-256) before approvers do.
        if (RequestReviewForm.Confirm(dlg.FileName)) ElevationPrompt.Request(dlg.FileName);
    }

    void Balloon(string title, string body)
    {
        if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(body)) return;
        _icon.BalloonTipTitle = title.Length > 63 ? title.Substring(0, 63) : title;
        _icon.BalloonTipText = body.Length > 255 ? body.Substring(0, 255) : body;
        _icon.ShowBalloonTip(10000);
    }

    static void OpenLog()
    {
        try
        {
            var path = BrokerLog.Path;
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            if (!File.Exists(path)) File.WriteAllText(path, "");
            System.Diagnostics.Process.Start("notepad.exe", path);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    /// <summary>
    /// Themed error dialog for failures inside error paths (e.g. the log
    /// viewer). Deliberately defensive: if building or showing the themed
    /// dialog throws — fonts missing, GDI+ unhappy in this session — fall
    /// back to the stock MessageBox. Error reporting must never itself crash
    /// the tray.
    /// </summary>
    static void ShowError(string message)
    {
        try
        {
            using var dlg = Ui.Dialog("PrivGate Agent", new Size(440, 200));
            var ok = Ui.Primary("OK");
            ok.Click += (_, _) => dlg.Close();
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Height = 46,
                Padding = new Padding(12),
                BackColor = Color.Transparent,
            };
            buttons.Controls.Add(ok);
            dlg.Controls.Add(Ui.Body(message, "Error detail"));
            dlg.Controls.Add(buttons);
            dlg.AcceptButton = ok;
            dlg.CancelButton = ok;
            dlg.ShowDialog();
        }
        catch
        {
            MessageBox.Show(message, "PrivGate Agent");
        }
    }

    /// <summary>
    /// Tray square size for the UI thread's device DPI (96 DPI → 16px, the
    /// floor). The process has no PerMonitorV2 manifest today, so this reads
    /// 96 and Windows scales — the math is ready if awareness lands later.
    /// </summary>
    int TrayPx() => Math.Max(AppIcon.MinPx, _form.DeviceDpi * 16 / 96);

    void Refresh()
    {
        // Runs every 1.5s on the UI thread. Any throw here used to escape into
        // the message loop and could end the tray (no icon, no consent watch).
        try
        {
            RefreshBody();
        }
        catch (Exception ex)
        {
            BrokerLog.Write("tray refresh failed: " + ex);
        }
    }

    void RefreshBody()
    {
        StatusSnapshot snap;
        if (_ownsBroker)
        {
            snap = BrokerStatus.Current.Snapshot("in-process");
        }
        else
        {
            snap = BrokerStatus.TryQueryPipe() ?? new StatusSnapshot
            {
                LastError = "Broker service is not reachable on the named pipe.",
                Source = "detached",
            };
        }
        _form.Bind(snap);
        var state = snap.Realtime ? "connected" : "offline";
        if (snap.JitActive) state = "JIT on";
        else if (!string.IsNullOrEmpty(snap.Pending)) state = "waiting";
        var text = $"PrivGate Agent ({state})";
        _icon.Text = text.Length <= 63 ? text : text.Substring(0, 63);
        // realtime down = Problem. The Problem state is a full-red shield
        // rather than amber+badge: at 16px a badge dot is ≤2px and vanishes,
        // while the color-only swap keeps the brand silhouette constant.
        var desired = AppIcon.Create(TrayPx(), snap.Realtime ? AppIconState.Normal : AppIconState.Problem);
        if (!ReferenceEquals(_icon.Icon, desired)) _icon.Icon = desired;
        if (snap.NoticeSeq > _seenNotice && snap.NoticeSeq > 0)
        {
            _seenNotice = snap.NoticeSeq;
            // Toast only: balloons die to focus assist and fullscreen apps,
            // and showing both duplicates every notice on the desktop.
            Toast.Show(snap.NoticeTitle, snap.NoticeBody);
        }
    }

    static bool ServiceInstalled()
    {
        try
        {
            using var sc = new ServiceController(BrokerService.Name);
            _ = sc.Status;
            return true;
        }
        catch
        {
            return false;
        }
    }

    static bool ServiceIsRunning()
    {
        try
        {
            using var sc = new ServiceController(BrokerService.Name);
            // Anything not clearly stopped (including StartPending during the
            // logon race) may own the pipe within seconds. Deciding "not
            // running" then hosting a second in-process broker makes both lose:
            // the second NamedPipeServerStream collides on the pipe name and
            // dies inside an unobserved task. Prefer deferring to the service.
            return sc.Status != ServiceControllerStatus.Stopped;
        }
        catch
        {
            return false;
        }
    }

    static void TryStartService()
    {
        try
        {
            using var sc = new ServiceController(BrokerService.Name);
            if (sc.Status == ServiceControllerStatus.Stopped) sc.Start();
        }
        catch (Exception ex)
        {
            BrokerLog.Write("tray could not start PrivGateBroker: " + ex.Message);
        }
    }

    protected override void ExitThreadCore()
    {
        _timer.Stop();
        _icon.Visible = false;
        _icon.Dispose();
        _form.Dispose();
        Heartbeat.Stop();
        if (_ownsBroker) _cts.Cancel();
        _cts.Dispose();
        base.ExitThreadCore();
    }
}
