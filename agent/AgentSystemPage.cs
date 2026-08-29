using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace PrivGate.Agent;

sealed class AgentSystemPage : Panel
{
    readonly Label _comm = Value();
    readonly Label _console = Value();
    readonly Label _version = Value();
    readonly Label _error = Value();
    readonly Label _updateHint = Value();
    readonly Button _check;
    readonly Button _install;
    string _latest = "";

    internal AgentSystemPage()
    {
        Dock = DockStyle.Fill;
        BackColor = Ui.Panel;
        Padding = new Padding(20, 12, 20, 16);
        _check = AgentChrome.Action("Check for updates");
        _install = AgentChrome.Action("Install update");
        _install.Visible = false;
        _check.Click += (_, _) => Check();
        _install.Click += (_, _) => Install();

        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 8,
            BackColor = Ui.Panel,
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddRow(grid, 0, "Communication", _comm);
        AddRow(grid, 1, "Console", _console);
        AddRow(grid, 2, "Agent version", _version);
        AddRow(grid, 3, "Last error", _error);
        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        grid.Controls.Add(_updateHint, 0, 4);
        grid.SetColumnSpan(_updateHint, 2);
        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            BackColor = Color.Transparent,
            AutoSize = true,
            Padding = new Padding(0, 8, 0, 0),
        };
        actions.Controls.Add(_check);
        actions.Controls.Add(_install);
        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        grid.Controls.Add(actions, 0, 5);
        grid.SetColumnSpan(actions, 2);
        Controls.Add(grid);
        _updateHint.ForeColor = Ui.Muted;
        Set(_updateHint, "Check whether the console has a newer client.");
    }

    internal void Bind(StatusSnapshot snap)
    {
        Set(_comm, snap.Realtime ? "Connected to the management console" : "Offline — no live session");
        _comm.ForeColor = snap.Realtime ? Ui.Ok : Ui.Bad;
        Set(_console, string.IsNullOrEmpty(snap.ApiBase) ? "No management server configured" : snap.ApiBase);
        var version = string.IsNullOrEmpty(snap.Version) ? UpdateManager.AgentVersion() : snap.Version;
        Set(_version, "v" + version);
        Set(_error, string.IsNullOrEmpty(snap.LastError) ? "—" : snap.LastError);
    }

    void Check()
    {
        _check.Enabled = false;
        _install.Visible = false;
        Set(_updateHint, "Checking…");
        Task.Run(() =>
        {
            try
            {
                var json = ElevationClient.CheckUpdate();
                BeginInvoke(new Action(() => ShowCheck(json)));
            }
            catch (Exception ex)
            {
                BeginInvoke(new Action(() =>
                {
                    Set(_updateHint, ex.Message);
                    _check.Enabled = true;
                }));
            }
        });
    }

    void ShowCheck(string json)
    {
        _check.Enabled = true;
        try
        {
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String)
            {
                Set(_updateHint, err.GetString() ?? "Check failed");
                return;
            }
            var installed = root.TryGetProperty("installed", out var i) ? i.GetString() ?? "" : "";
            var latest = root.TryGetProperty("latest", out var l) ? l.GetString() ?? "" : "";
            var available = root.TryGetProperty("available", out var a) && a.ValueKind == JsonValueKind.True;
            _latest = latest;
            if (!available)
            {
                Set(_updateHint, "You're up to date (v" + installed + ").");
                return;
            }
            Set(_updateHint, "v" + latest + " is available. You are on v" + installed + ".");
            _install.Visible = true;
        }
        catch
        {
            Set(_updateHint, "The console did not return a usable update status.");
        }
    }

    void Install()
    {
        if (string.IsNullOrWhiteSpace(_latest)) return;
        _install.Enabled = false;
        Set(_updateHint, "Installing v" + _latest + " — the agent will restart.");
        Task.Run(() =>
        {
            try
            {
                ElevationClient.ApplyUpdate(_latest);
            }
            catch (Exception ex)
            {
                BeginInvoke(new Action(() =>
                {
                    Set(_updateHint, ex.Message);
                    _install.Enabled = true;
                }));
            }
        });
    }

    static void AddRow(TableLayoutPanel grid, int row, string title, Label value)
    {
        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        grid.Controls.Add(new Label
        {
            Text = title,
            Font = AgentChrome.Caption,
            ForeColor = Ui.Muted,
            AutoSize = true,
            Padding = new Padding(0, 8, 12, 8),
            AccessibleName = title,
        }, 0, row);
        grid.Controls.Add(value, 1, row);
    }

    static Label Value() => new()
    {
        Font = AgentChrome.Body,
        ForeColor = Ui.Ink,
        AutoSize = true,
        MaximumSize = new Size(420, 0),
        Padding = new Padding(0, 8, 0, 8),
    };

    static void Set(Label label, string text)
    {
        label.Text = text;
        label.AccessibleName = text;
    }
}
