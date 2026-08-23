using System.Drawing;
using System.ServiceProcess;
using System.Windows.Forms;

namespace PrivGate.Agent;

sealed class AgentTrayContext : ApplicationContext
{
    readonly NotifyIcon _icon;
    readonly AgentStatusForm _form;
    readonly System.Windows.Forms.Timer _timer;
    readonly string[] _args;
    readonly CancellationTokenSource _cts = new();
    readonly bool _ownsBroker;

    public AgentTrayContext(string[] args)
    {
        _args = args;
        var existing = BrokerStatus.TryQueryPipe();
        _ownsBroker = existing == null && !ServiceIsRunning();
        if (_ownsBroker)
        {
            _ = Task.Run(() => BrokerHost.RunAsync(_args, _cts.Token));
        }

        _form = new AgentStatusForm();
        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Visible = true,
            Text = "PrivGate Agent",
            ContextMenuStrip = BuildMenu(),
        };
        _icon.DoubleClick += (_, _) => ShowStatus();
        _timer = new System.Windows.Forms.Timer { Interval = 1500 };
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();
        ShowStatus();
    }

    ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Status", null, (_, _) => ShowStatus());
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
            MessageBox.Show(ex.Message, "PrivGate Agent");
        }
    }

    void Refresh()
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
        var text = $"PrivGate Agent ({state})";
        _icon.Text = text.Length <= 63 ? text : text.Substring(0, 63);
        _icon.Icon = snap.Realtime ? SystemIcons.Shield : SystemIcons.Warning;
    }

    static bool ServiceIsRunning()
    {
        try
        {
            using var sc = new ServiceController(BrokerService.Name);
            return sc.Status == ServiceControllerStatus.Running;
        }
        catch
        {
            return false;
        }
    }

    protected override void ExitThreadCore()
    {
        _timer.Stop();
        _icon.Visible = false;
        _icon.Dispose();
        _form.Dispose();
        if (_ownsBroker) _cts.Cancel();
        _cts.Dispose();
        base.ExitThreadCore();
    }
}

sealed class AgentStatusForm : Form
{
    readonly Label _realtime = Field();
    readonly Label _device = Field();
    readonly Label _host = Field();
    readonly Label _api = Field();
    readonly Label _source = Field();
    readonly Label _error = Field();
    readonly ListBox _requests = new() { Dock = DockStyle.Fill, Font = new Font("Consolas", 9f) };

    public AgentStatusForm()
    {
        Text = "PrivGate Agent";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(520, 420);
        Size = new Size(560, 480);
        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };

        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 2,
            RowCount = 8,
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddRow(grid, 0, "Realtime", _realtime);
        AddRow(grid, 1, "Device", _device);
        AddRow(grid, 2, "Hostname", _host);
        AddRow(grid, 3, "Console", _api);
        AddRow(grid, 4, "Source", _source);
        AddRow(grid, 5, "Last error", _error);
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        grid.Controls.Add(new Label { Text = "Requests", AutoSize = true, Padding = new Padding(0, 8, 0, 0) }, 0, 6);
        grid.SetColumnSpan(_requests, 2);
        grid.Controls.Add(_requests, 0, 7);
        Controls.Add(grid);
    }

    public void Bind(StatusSnapshot snap)
    {
        _realtime.Text = snap.Realtime
            ? $"Connected since {snap.ConnectedAt ?? "now"}  (reconnects {snap.Reconnects})"
            : "Offline";
        _realtime.ForeColor = snap.Realtime ? Color.ForestGreen : Color.Firebrick;
        _device.Text = string.IsNullOrEmpty(snap.DeviceId) ? "—" : snap.DeviceId;
        _host.Text = snap.Hostname;
        _api.Text = string.IsNullOrEmpty(snap.ApiBase) ? "—" : snap.ApiBase;
        _source.Text = string.IsNullOrEmpty(snap.Source) ? "—" : snap.Source;
        _error.Text = string.IsNullOrEmpty(snap.LastError) ? "—" : snap.LastError;
        _requests.BeginUpdate();
        _requests.Items.Clear();
        foreach (var row in snap.Requests.Reverse())
        {
            _requests.Items.Add($"{row.At}  {row.Decision,-8}  {row.Path}");
        }
        if (_requests.Items.Count == 0) _requests.Items.Add("No elevation requests yet.");
        _requests.EndUpdate();
    }

    static Label Field() => new()
    {
        AutoSize = true,
        MaximumSize = new Size(400, 0),
        Padding = new Padding(0, 4, 0, 4),
    };

    static void AddRow(TableLayoutPanel grid, int row, string title, Control value)
    {
        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        grid.Controls.Add(new Label { Text = title, AutoSize = true, Padding = new Padding(0, 4, 0, 0) }, 0, row);
        grid.Controls.Add(value, 1, row);
    }
}
