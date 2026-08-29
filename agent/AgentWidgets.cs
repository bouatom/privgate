using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Console-matched chips, cards, and micro-labels for the agent window.
/// Tokens live in <see cref="Ui"/>; this file only composes them.
/// </summary>
static class AgentWidgets
{
    internal static readonly Font Micro = new("Segoe UI", 8.25f);
    internal static readonly Font Brand = new("Segoe UI Semibold", 13f);
    internal static readonly Font Sub = new("Segoe UI", 11f);

    internal static Label MicroText(string text, string? accessibleName = null)
    {
        var upper = text.ToUpperInvariant();
        return new Label
        {
            Text = upper,
            Font = Micro,
            ForeColor = Ui.Muted,
            AutoSize = true,
            BackColor = Color.Transparent,
            AccessibleName = accessibleName ?? upper,
        };
    }

    /// <summary>Console .pill: 1px border, 8.25pt, tracking via uppercase.</summary>
    internal static Label Pill(string text, Color fg, Color border)
    {
        var label = new Label
        {
            Text = text.ToUpperInvariant(),
            Font = Micro,
            ForeColor = fg,
            AutoSize = true,
            Padding = new Padding(8, 3, 8, 3),
            BackColor = Ui.Bg,
            AccessibleName = text,
        };
        label.Paint += (_, e) =>
        {
            var edge = label.Tag is Color tagged ? tagged : border;
            using var pen = new Pen(edge);
            var r = label.ClientRectangle;
            e.Graphics.DrawRectangle(pen, 0, 0, r.Width - 1, r.Height - 1);
        };
        return label;
    }

    internal static Label DecisionPill(string decision)
    {
        var key = (decision ?? "").Trim().ToLowerInvariant();
        return key switch
        {
            "allow" or "approved" => Pill("Allowed", Ui.Ok, Ui.PillOkLine),
            "deny" or "denied" => Pill("Denied", Ui.Bad, Ui.PillBadLine),
            "pending" => Pill("Pending", Ui.Amber2, Ui.PillPendingLine),
            "canceled" or "cancelled" => Pill("Canceled", Ui.Muted, Ui.Line),
            _ => Pill(string.IsNullOrWhiteSpace(key) ? "—" : decision ?? "—", Ui.Muted, Ui.Line),
        };
    }

    internal static FlowLayoutPanel Card()
    {
        var card = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            BackColor = Ui.Bg,
            Padding = new Padding(14, 12, 14, 12),
            Margin = new Padding(0, 0, 0, 10),
            MinimumSize = new Size(120, 56),
        };
        return card;
    }

    internal static void DrawCardFrame(Control card, PaintEventArgs e)
    {
        using var pen = new Pen(Ui.Line);
        var r = card.ClientRectangle;
        e.Graphics.DrawRectangle(pen, 0, 0, r.Width - 1, r.Height - 1);
    }

    internal static void DrawLiveDot(Graphics g, Rectangle bounds, Color fill)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var brush = new SolidBrush(fill);
        var d = Math.Min(bounds.Width, bounds.Height) - 2;
        g.FillEllipse(brush, bounds.X + 1, bounds.Y + 1, d, d);
    }
}
