using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Status window for the tray, themed after the management console's dark
/// instrument look: navy panel, ink values, muted small-caps field labels,
/// semibold title, hairline separators, amber/ok/bad accents from Ui.*.
/// Requests stay Consolas because rows are aligned log lines, but the list is
/// recolored dark via owner draw — no white rows.
/// Behavior contract unchanged: Bind() refreshes fields from a BrokerStatus
/// snapshot every tray tick; user-close hides instead of exiting (the tray
/// owns lifetime); window stays resizable with the same MinimumSize floor.
/// </summary>
sealed class AgentStatusForm : Form
{
    readonly Label _realtime = Field();
    readonly Label _device = Field();
    readonly Label _host = Field();
    readonly Label _api = Field();
    readonly Label _source = Field();
    readonly Label _jit = Field();
    readonly Label _pending = Field();
    readonly Label _error = Field();
    readonly ListBox _requests = MakeRequestsList();

    public AgentStatusForm()
    {
        Text = "PrivGate Agent";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(520, 420);
        Size = new Size(560, 480);
        BackColor = Ui.Panel;
        ForeColor = Ui.Ink;
        Font = new Font("Segoe UI", 9f);
        Icon = AppIcon.Create(32); // taskbar + title bar share the brand tile
        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };

        Controls.Add(Body());
        Controls.Add(Header());
    }

    /// <summary>Title strip: brand name over a hairline rule, docked top.</summary>
    Control Header()
    {
        var head = new Panel { Dock = DockStyle.Top, Height = 56, BackColor = Ui.Panel };
        head.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
        head.Controls.Add(new Label
        {
            Text = "PrivGate Agent",
            Font = new Font("Segoe UI Semibold", 12f),
            ForeColor = Ui.Amber,
            AutoSize = true,
            Location = new Point(16, 14),
            AccessibleName = "PrivGate agent status",
        });
        return head;
    }

    Control Body()
    {
        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 2,
            RowCount = 10,
            BackColor = Ui.Panel,
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddField(grid, 0, "Realtime", _realtime);
        AddField(grid, 1, "Device", _device);
        AddField(grid, 2, "Hostname", _host);
        AddField(grid, 3, "Console", _api);
        AddField(grid, 4, "Source", _source);
        AddField(grid, 5, "JIT admin", _jit);
        AddField(grid, 6, "Pending request", _pending);
        AddField(grid, 7, "Last error", _error);

        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var caption = SectionLabel("Requests");
        grid.Controls.Add(caption, 0, 8);
        grid.SetColumnSpan(caption, 2);
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        grid.Controls.Add(_requests, 0, 9);
        grid.SetColumnSpan(_requests, 2);
        return grid;
    }

    public void Bind(StatusSnapshot snap)
    {
        Set(_realtime, snap.Realtime
            ? $"Connected since {snap.ConnectedAt ?? "now"}  (reconnects {snap.Reconnects})"
            : "Offline");
        _realtime.ForeColor = snap.Realtime ? Ui.Ok : Ui.Bad;
        Set(_device, string.IsNullOrEmpty(snap.DeviceId) ? "—" : snap.DeviceId);
        Set(_host, snap.Hostname);
        Set(_api, string.IsNullOrEmpty(snap.ApiBase) ? "—" : snap.ApiBase);
        Set(_source, string.IsNullOrEmpty(snap.Source) ? "—" : snap.Source);
        Set(_jit, snap.JitActive
            ? "On until " + (snap.JitUntil ?? "expiry") +
              ". Request a program from the tray to open it on this desktop without signing out."
            : "Off");
        Set(_pending, string.IsNullOrEmpty(snap.Pending) ? "—" : snap.Pending);
        Set(_error, string.IsNullOrEmpty(snap.LastError) ? "—" : snap.LastError);
        _requests.BeginUpdate();
        _requests.Items.Clear();
        foreach (var row in snap.Requests.Reverse())
        {
            _requests.Items.Add($"{row.At}  {row.Decision,-8}  {row.Path}");
        }
        if (_requests.Items.Count == 0) _requests.Items.Add("No requests yet.");
        _requests.EndUpdate();
    }

    static void Set(Label label, string text)
    {
        label.Text = text;
        label.AccessibleName = text; // screen readers hear the current value
    }

    /// <summary>Small muted caps field caption; AccessibleName keeps case.</summary>
    static Label Caption(string title) => new()
    {
        Text = title.ToUpperInvariant(),
        Font = new Font("Segoe UI", 7.5f),
        ForeColor = Ui.Muted,
        AutoSize = true,
        Margin = Padding.Empty,
        Padding = new Padding(0, 6, 0, 0),
        AccessibleName = title,
    };

    static Label SectionLabel(string title)
    {
        var label = Caption(title);
        label.Padding = new Padding(0, 10, 0, 4);
        return label;
    }

    static Label Field() => new()
    {
        AutoSize = true,
        MaximumSize = new Size(400, 0),
        Margin = Padding.Empty,
        Padding = new Padding(0, 4, 0, 4),
        ForeColor = Ui.Ink,
    };

    static void AddField(TableLayoutPanel grid, int row, string title, Label value)
    {
        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        grid.Controls.Add(Caption(title), 0, row);
        grid.Controls.Add(value, 1, row);
    }

    /// <summary>
    /// Dark request log: navy surface, no border, owner-drawn rows so the
    /// selection uses the console hairline tone instead of system blue.
    /// </summary>
    static ListBox MakeRequestsList()
    {
        var list = new ListBox
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.None,
            BackColor = Ui.Bg,
            ForeColor = Ui.Ink,
            Font = new Font("Consolas", 9f),
            DrawMode = DrawMode.OwnerDrawFixed,
            ItemHeight = 18,
            Margin = Padding.Empty,
            AccessibleName = "Recent requests",
        };
        list.DrawItem += DrawRequestRow;
        return list;
    }

    static void DrawRequestRow(object? sender, DrawItemEventArgs e)
    {
        if (e.Index < 0 || sender is not ListBox list) return;
        bool selected = (e.State & DrawItemState.Selected) != 0;
        using (var bg = new SolidBrush(selected ? Ui.Line : Ui.Bg))
        {
            e.Graphics.FillRectangle(bg, e.Bounds);
        }
        var text = list.Items[e.Index]?.ToString() ?? "";
        TextRenderer.DrawText(e.Graphics, text, list.Font,
            new Rectangle(e.Bounds.X + 6, e.Bounds.Y, Math.Max(0, e.Bounds.Width - 8), e.Bounds.Height),
            Ui.Ink,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter |
            TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }
}
