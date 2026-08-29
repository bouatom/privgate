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
        MaximumSize = new Size(640, 0),
        Padding = new Padding(0, 4, 0, 0),
        BackColor = Color.Transparent,
    };
    readonly ListBox _past;

    internal AgentRequestsPage()
    {
        Dock = DockStyle.Fill;
        BackColor = Color.Transparent;
        _past = new ListBox
        {
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.None,
            BackColor = Ui.Bg,
            ForeColor = Ui.Ink,
            Font = AgentChrome.Caption,
            DrawMode = DrawMode.OwnerDrawFixed,
            ItemHeight = 36,
            IntegralHeight = false,
            AccessibleName = "Recent elevation requests",
        };
        _past.DrawItem += DrawRow;
        _past.Paint += (_, e) => AgentWidgets.DrawCardFrame(_past, e);

        var waiting = AgentWidgets.Card();
        waiting.Paint += (s, e) =>
        {
            if (s is Control c) AgentWidgets.DrawCardFrame(c, e);
        };
        waiting.Dock = DockStyle.Top;
        var waitingCap = AgentWidgets.MicroText("Waiting for approval", "Waiting for approval");
        waiting.Controls.Add(waitingCap);
        waiting.Controls.Add(_current);

        var recentCap = AgentWidgets.MicroText("Recent", "Recent requests");
        recentCap.Dock = DockStyle.Top;
        recentCap.Padding = new Padding(0, 12, 0, 6);

        Controls.Add(_past);
        Controls.Add(recentCap);
        Controls.Add(waiting);
    }

    internal void Bind(StatusSnapshot snap)
    {
        if (string.IsNullOrEmpty(snap.Pending))
        {
            _current.Text = "Nothing waiting.";
            _current.AccessibleName = "Nothing waiting";
            _current.ForeColor = Ui.Muted;
        }
        else
        {
            _current.Text = snap.Pending;
            _current.AccessibleName = snap.Pending;
            _current.ForeColor = Ui.Ink;
        }
        _past.BeginUpdate();
        _past.Items.Clear();
        foreach (var row in snap.Requests.Reverse())
        {
            _past.Items.Add(new RequestLine(row.At, row.Decision, row.Path));
        }
        if (_past.Items.Count == 0) _past.Items.Add(RequestLine.Empty);
        _past.EndUpdate();
    }

    static void DrawRow(object? sender, DrawItemEventArgs e)
    {
        if (e.Index < 0 || sender is not ListBox list) return;
        var selected = (e.State & DrawItemState.Selected) != 0;
        using (var bg = new SolidBrush(selected ? Ui.NavActive : Ui.Bg))
        {
            e.Graphics.FillRectangle(bg, e.Bounds);
        }
        var line = list.Items[e.Index] as RequestLine ?? RequestLine.Empty;
        var x = e.Bounds.X + 10;
        var y = e.Bounds.Y;
        var h = e.Bounds.Height;
        TextRenderer.DrawText(e.Graphics, line.At, AgentWidgets.Micro,
            new Rectangle(x, y, 72, h), Ui.Muted,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
        x += 76;
        var pill = line.DecisionLabel;
        var pillSize = TextRenderer.MeasureText(pill, AgentWidgets.Micro);
        var pillBox = new Rectangle(x, y + (h - 20) / 2, Math.Max(64, pillSize.Width + 10), 20);
        using (var pen = new Pen(line.Border))
        {
            e.Graphics.DrawRectangle(pen, pillBox);
        }
        TextRenderer.DrawText(e.Graphics, pill, AgentWidgets.Micro, pillBox, line.Fg,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
        x = pillBox.Right + 10;
        TextRenderer.DrawText(e.Graphics, line.Path, AgentChrome.Caption,
            new Rectangle(x, y, Math.Max(0, e.Bounds.Right - x - 8), h), Ui.Ink,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter |
            TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    sealed class RequestLine
    {
        internal static readonly RequestLine Empty = new("", "", "");

        internal RequestLine(string at, string decision, string path)
        {
            At = at ?? "";
            Decision = decision ?? "";
            Path = string.IsNullOrWhiteSpace(path) ? "No elevation requests on this PC yet." : path;
        }

        internal string At { get; }
        internal string Decision { get; }
        internal string Path { get; }

        internal string DecisionLabel
        {
            get
            {
                var key = Decision.Trim().ToLowerInvariant();
                return key switch
                {
                    "allow" or "approved" => "ALLOWED",
                    "deny" or "denied" => "DENIED",
                    "pending" => "PENDING",
                    "canceled" or "cancelled" => "CANCELED",
                    _ => string.IsNullOrWhiteSpace(Decision) ? "—" : Decision.ToUpperInvariant(),
                };
            }
        }

        internal Color Fg => Decision.Trim().ToLowerInvariant() switch
        {
            "allow" or "approved" => Ui.Ok,
            "deny" or "denied" => Ui.Bad,
            "pending" => Ui.Amber2,
            _ => Ui.Muted,
        };

        internal Color Border => Decision.Trim().ToLowerInvariant() switch
        {
            "allow" or "approved" => Ui.PillOkLine,
            "deny" or "denied" => Ui.PillBadLine,
            "pending" => Ui.PillPendingLine,
            _ => Ui.Line,
        };

        public override string ToString() =>
            string.IsNullOrEmpty(Decision) ? Path : At + " " + Decision + " " + Path;
    }
}
