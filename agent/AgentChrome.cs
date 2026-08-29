using System.Drawing;
using System.Drawing.Drawing2D;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Borderless console-matched chrome: DWM dark + round corners, a shield
/// lockup instead of an amber title, and a 1px hairline (no OS white bar).
/// </summary>
static class AgentChrome
{
    const int WmNclbuttondown = 0x00A1;
    const int HtCaption = 2;
    const int DwmwaWindowCornerPreference = 33;
    const int DwmwaUseImmersiveDarkMode = 20;
    const int DwmWcpRound = 2;

    internal static readonly Font Body = new("Segoe UI", 12f);
    internal static readonly Font Caption = AgentWidgets.Sub;
    internal static readonly Font TabFont = new("Segoe UI Semibold", 12f);

    internal static void Apply(Form form)
    {
        form.FormBorderStyle = FormBorderStyle.None;
        form.BackColor = Ui.Bg;
        form.ForeColor = Ui.Ink;
        form.Font = Body;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Padding = new Padding(1);
        typeof(Control).GetProperty("DoubleBuffered", BindingFlags.Instance | BindingFlags.NonPublic)
            ?.SetValue(form, true);
        form.Paint += (_, e) => PaintShell(form, e.Graphics);
        form.Shown += (_, _) => TryRoundAndDark(form);
    }

    /// <summary>
    /// Caption lockup: 20px shield, PrivGate / Agent, live pill, hide control.
    /// Amber is reserved for the mark — the wordmark is ink, like the console rail.
    /// </summary>
    internal static AgentCaption CaptionBar(Form form, Action hide)
    {
        return new AgentCaption(form, hide);
    }

    internal static Button TabButton(string text, bool active)
    {
        var b = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            Font = TabFont,
            Height = 40,
            Width = 128,
            BackColor = Color.Transparent,
            ForeColor = active ? Ui.Ink : Ui.Muted,
            UseVisualStyleBackColor = false,
            AccessibleName = text,
            Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderSize = 0;
        b.FlatAppearance.MouseOverBackColor = Ui.NavActive;
        Ui.RingOnFocus(b, Ui.Amber);
        return b;
    }

    internal static Button Action(string text)
    {
        var b = Ui.Primary(text);
        b.Font = Caption;
        b.AutoSize = false;
        b.Size = new Size(168, 36);
        return b;
    }

    static void PaintShell(Form form, Graphics g)
    {
        var w = form.ClientSize.Width;
        var h = form.ClientSize.Height;
        try
        {
            using var path = new GraphicsPath();
            path.AddEllipse(-80, -120, 420, 280);
            using var spot = new PathGradientBrush(path)
            {
                CenterColor = Color.FromArgb(90, Ui.Spot),
                SurroundColors = new[] { Color.FromArgb(0, Ui.Spot) },
                CenterPoint = new PointF(40, 8),
            };
            g.FillRectangle(spot, 0, 0, w, 96);
        }
        catch
        {
            // PathGradientBrush is picky on some GDI+ builds; skip the wash.
        }
        using (var hi = new Pen(Color.FromArgb(28, 255, 255, 255)))
        {
            g.DrawLine(hi, 1, 1, w - 2, 1);
        }
        using var pen = new Pen(Ui.Line);
        g.DrawRectangle(pen, 0, 0, w - 1, h - 1);
    }

    static void TryRoundAndDark(Form form)
    {
        try
        {
            var hwnd = form.Handle;
            var dark = 1;
            DwmSetWindowAttribute(hwnd, DwmwaUseImmersiveDarkMode, ref dark, sizeof(int));
            var round = DwmWcpRound;
            DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref round, sizeof(int));
        }
        catch
        {
            // Win7 / missing dwmapi: square edges are fine.
        }
    }

    internal static void Drag(Form form, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(form.Handle, WmNclbuttondown, (IntPtr)HtCaption, IntPtr.Zero);
    }

    [DllImport("user32.dll")]
    static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}

/// <summary>Top chrome: brand lockup, connection chip, hide (does not quit).</summary>
sealed class AgentCaption
{
    internal readonly Panel Bar;
    readonly Panel _dot;
    readonly Label _live;

    internal AgentCaption(Form form, Action hide)
    {
        Bar = new Panel
        {
            Dock = DockStyle.Top,
            Height = 56,
            BackColor = Color.Transparent,
            AccessibleName = "PrivGate Agent",
        };
        Bar.MouseDown += (_, e) => AgentChrome.Drag(form, e);

        var mark = new PictureBox
        {
            Size = new Size(20, 20),
            Location = new Point(16, 18),
            SizeMode = PictureBoxSizeMode.StretchImage,
            Image = AppIcon.Create(20).ToBitmap(),
            BackColor = Color.Transparent,
            AccessibleName = "PrivGate",
        };
        mark.MouseDown += (_, e) => AgentChrome.Drag(form, e);

        var name = new Label
        {
            Text = "PrivGate",
            Font = AgentWidgets.Brand,
            ForeColor = Ui.Ink,
            AutoSize = true,
            Location = new Point(44, 8),
            BackColor = Color.Transparent,
            AccessibleName = "PrivGate",
        };
        var role = new Label
        {
            Text = "Agent",
            Font = AgentWidgets.Sub,
            ForeColor = Ui.Muted,
            AutoSize = true,
            Location = new Point(44, 28),
            BackColor = Color.Transparent,
            AccessibleName = "Agent",
        };
        name.MouseDown += (_, e) => AgentChrome.Drag(form, e);
        role.MouseDown += (_, e) => AgentChrome.Drag(form, e);

        _dot = new Panel
        {
            Size = new Size(8, 8),
            Location = new Point(0, 24),
            BackColor = Color.Transparent,
        };
        _dot.Paint += (_, e) => AgentWidgets.DrawLiveDot(e.Graphics, _dot.ClientRectangle, _dot.ForeColor);
        _live = AgentWidgets.MicroText("Offline", "Console connection");
        _live.Location = new Point(0, 20);

        var close = new Button
        {
            Text = "✕",
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.Transparent,
            ForeColor = Ui.Muted,
            Font = AgentChrome.Caption,
            Size = new Size(44, 36),
            Location = new Point(0, 10),
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
            UseVisualStyleBackColor = false,
            AccessibleName = "Hide window",
            Cursor = Cursors.Hand,
        };
        close.FlatAppearance.BorderSize = 0;
        close.MouseEnter += (_, _) =>
        {
            close.BackColor = Ui.Bad;
            close.ForeColor = Ui.Ink;
        };
        close.MouseLeave += (_, _) =>
        {
            close.BackColor = Color.Transparent;
            close.ForeColor = Ui.Muted;
        };
        close.Click += (_, _) => hide();
        Ui.RingOnFocus(close, Ui.Amber);

        Bar.Resize += (_, _) =>
        {
            close.Left = Math.Max(0, Bar.Width - close.Width - 8);
            _live.Left = Math.Max(180, close.Left - _live.PreferredWidth - 20);
            _dot.Left = _live.Left - 14;
        };
        Bar.Controls.Add(close);
        Bar.Controls.Add(_live);
        Bar.Controls.Add(_dot);
        Bar.Controls.Add(role);
        Bar.Controls.Add(name);
        Bar.Controls.Add(mark);
        Bar.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
    }

    internal void BindLive(bool connected)
    {
        _live.Text = connected ? "CONNECTED" : "OFFLINE";
        _live.AccessibleName = connected ? "Connected to the management console" : "Offline";
        _live.ForeColor = connected ? Ui.Ok : Ui.Bad;
        _dot.ForeColor = connected ? Ui.Ok : Ui.Bad;
        _dot.Invalidate();
    }
}
