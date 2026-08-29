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
    readonly Label _errorCap;
    readonly Label _updateHint = Value();
    readonly Button _check;
    readonly Button _install;
    string _latest = "";

    internal AgentSystemPage()
    {
        Dock = DockStyle.Fill;
        BackColor = Color.Transparent;
        _check = AgentChrome.Action("Check for updates");
        _install = AgentChrome.Action("Install update");
        _install.Visible = false;
        _check.Click += (_, _) => Check();
        _install.Click += (_, _) => Install();

        var health = FieldCard("Status");
        AddField(health, "Console connection", _comm);
        AddField(health, "Console", _console);
        AddField(health, "Agent version", _version);
        _errorCap = AgentWidgets.MicroText("Last error", "Last error");
        _errorCap.Padding = new Padding(0, 10, 0, 2);
        _errorCap.Visible = false;
        _error.Visible = false;
        health.Controls.Add(_errorCap);
        health.Controls.Add(_error);

        var update = FieldCard("Client update");
        _updateHint.ForeColor = Ui.Muted;
        Set(_updateHint, "Check whether IT has published a newer client.");
        update.Controls.Add(_updateHint);
        var actions = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            BackColor = Color.Transparent,
            Padding = new Padding(0, 10, 0, 0),
            WrapContents = false,
        };
        actions.Controls.Add(_check);
        actions.Controls.Add(_install);
        update.Controls.Add(actions);

        Controls.Add(update);
        Controls.Add(health);
    }

    internal void Bind(StatusSnapshot snap)
    {
        Set(_comm, snap.Realtime ? "Connected" : "Offline");
        _comm.ForeColor = snap.Realtime ? Ui.Ok : Ui.Bad;
        Set(_console, string.IsNullOrEmpty(snap.ApiBase) ? "No management server configured" : snap.ApiBase);
        var version = string.IsNullOrEmpty(snap.Version) ? UpdateManager.AgentVersion() : snap.Version;
        Set(_version, "v" + version);
        var err = (snap.LastError ?? "").Trim();
        var showErr = err.Length > 0;
        _errorCap.Visible = showErr;
        _error.Visible = showErr;
        if (showErr)
        {
            Set(_error, err);
            _error.ForeColor = Ui.Bad;
        }
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

    static Panel FieldCard(string title)
    {
        var card = AgentWidgets.Card();
        card.Paint += (s, e) =>
        {
            if (s is Control c) AgentWidgets.DrawCardFrame(c, e);
        };
        var cap = AgentWidgets.MicroText(title, title);
        cap.Padding = new Padding(0, 0, 0, 8);
        card.Controls.Add(cap);
        return card;
    }

    static void AddField(Panel card, string title, Label value)
    {
        var cap = AgentWidgets.MicroText(title, title);
        cap.Padding = new Padding(0, 8, 0, 2);
        card.Controls.Add(cap);
        card.Controls.Add(value);
    }

    static Label Value() => new()
    {
        Font = AgentChrome.Body,
        ForeColor = Ui.Ink,
        AutoSize = true,
        MaximumSize = new Size(640, 0),
        Padding = new Padding(0, 0, 0, 4),
        BackColor = Color.Transparent,
    };

    static void Set(Label label, string text)
    {
        label.Text = text;
        label.AccessibleName = text;
    }
}
