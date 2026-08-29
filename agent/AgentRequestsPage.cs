using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

sealed class AgentRequestsPage : Panel
{
    readonly Label _current = new()
    {
        Font = AgentChrome.Body,
        ForeColor = Ui.Ink,
        AutoSize = true,
        MaximumSize = new Size(560, 0),
        Padding = new Padding(0, 0, 0, 12),
    };
    readonly ListBox _past;

    internal AgentRequestsPage()
    {
        Dock = DockStyle.Fill;
        BackColor = Ui.Panel;
        Padding = new Padding(20, 12, 20, 16);
        _past = new ListBox
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.None,
            BackColor = Ui.Bg,
            ForeColor = Ui.Ink,
            Font = AgentChrome.Body,
            DrawMode = DrawMode.OwnerDrawFixed,
            ItemHeight = 28,
            IntegralHeight = false,
            AccessibleName = "Past elevation requests",
        };
        _past.DrawItem += DrawRow;

        var currentCap = new Label
        {
            Text = "Current",
            Font = AgentChrome.Caption,
            ForeColor = Ui.Muted,
            AutoSize = true,
            Padding = new Padding(0, 0, 0, 4),
            AccessibleName = "Current request",
        };
        var pastCap = new Label
        {
            Text = "Past",
            Font = AgentChrome.Caption,
            ForeColor = Ui.Muted,
            AutoSize = true,
            Padding = new Padding(0, 12, 0, 6),
            Dock = DockStyle.Top,
            AccessibleName = "Past requests",
        };

        var top = new Panel { Dock = DockStyle.Top, Height = 88, BackColor = Ui.Panel };
        currentCap.Location = new Point(0, 0);
        _current.Location = new Point(0, 28);
        top.Controls.Add(_current);
        top.Controls.Add(currentCap);

        Controls.Add(_past);
        Controls.Add(pastCap);
        Controls.Add(top);
    }

    internal void Bind(StatusSnapshot snap)
    {
        var pending = string.IsNullOrEmpty(snap.Pending) ? "None" : snap.Pending;
        _current.Text = pending;
        _current.AccessibleName = pending;
        _current.ForeColor = string.IsNullOrEmpty(snap.Pending) ? Ui.Muted : Ui.Amber;
        _past.BeginUpdate();
        _past.Items.Clear();
        foreach (var row in snap.Requests.Reverse())
        {
            _past.Items.Add($"{row.At}  {row.Decision,-10}  {row.Path}");
        }
        if (_past.Items.Count == 0) _past.Items.Add("No elevation requests yet.");
        _past.EndUpdate();
    }

    static void DrawRow(object? sender, DrawItemEventArgs e)
    {
        if (e.Index < 0 || sender is not ListBox list) return;
        var selected = (e.State & DrawItemState.Selected) != 0;
        using (var bg = new SolidBrush(selected ? Ui.Line : Ui.Bg))
        {
            e.Graphics.FillRectangle(bg, e.Bounds);
        }
        var text = list.Items[e.Index]?.ToString() ?? "";
        TextRenderer.DrawText(e.Graphics, text, list.Font,
            new Rectangle(e.Bounds.X + 8, e.Bounds.Y, Math.Max(0, e.Bounds.Width - 12), e.Bounds.Height),
            Ui.Ink,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter |
            TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }
}
