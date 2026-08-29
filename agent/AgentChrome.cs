using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Borderless muted chrome for the agent window so the OS caption (white on
/// most Windows 10/11 images) never sits on top of the navy panel.
/// </summary>
static class AgentChrome
{
    const int WmNclbuttondown = 0x00A1;
    const int HtCaption = 2;
    const int DwmwaWindowCornerPreference = 33;
    const int DwmwaUseImmersiveDarkMode = 20;
    const int DwmWcpRound = 2;

    internal static readonly Font Title = new("Segoe UI Semibold", 14f);
    internal static readonly Font Hero = new("Segoe UI Semibold", 22f);
    internal static readonly Font Body = new("Segoe UI", 12f);
    internal static readonly Font Caption = new("Segoe UI", 11f);
    internal static readonly Font TabFont = new("Segoe UI Semibold", 12f);

    internal static void Apply(Form form)
    {
        form.FormBorderStyle = FormBorderStyle.None;
        form.BackColor = Ui.Panel;
        form.ForeColor = Ui.Ink;
        form.Font = Body;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Padding = new Padding(1);
        form.Paint += (_, e) =>
        {
            using var pen = new Pen(Ui.Line);
            e.Graphics.DrawRectangle(pen, 0, 0, form.ClientSize.Width - 1, form.ClientSize.Height - 1);
        };
        form.Shown += (_, _) => TryRoundAndDark(form);
    }

    internal static Panel CaptionBar(Form form, string title, Action hide)
    {
        var bar = new Panel
        {
            Dock = DockStyle.Top,
            Height = 48,
            BackColor = Ui.Panel,
            AccessibleName = title,
        };
        bar.MouseDown += (_, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(form.Handle, WmNclbuttondown, (IntPtr)HtCaption, IntPtr.Zero);
        };
        var label = new Label
        {
            Text = title,
            Font = Title,
            ForeColor = Ui.Amber,
            AutoSize = true,
            Location = new Point(16, 12),
            BackColor = Color.Transparent,
            AccessibleName = title,
        };
        label.MouseDown += (_, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(form.Handle, WmNclbuttondown, (IntPtr)HtCaption, IntPtr.Zero);
        };
        var close = new Button
        {
            Text = "✕",
            FlatStyle = FlatStyle.Flat,
            BackColor = Ui.Panel,
            ForeColor = Ui.Ink,
            Font = Caption,
            Size = new Size(44, 36),
            Location = new Point(0, 6),
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
            UseVisualStyleBackColor = false,
            AccessibleName = "Close",
        };
        close.FlatAppearance.BorderSize = 0;
        close.FlatAppearance.MouseOverBackColor = Ui.Line;
        close.Click += (_, _) => hide();
        bar.Resize += (_, _) => close.Left = Math.Max(0, bar.Width - close.Width - 8);
        bar.Controls.Add(close);
        bar.Controls.Add(label);
        bar.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
        return bar;
    }

    internal static Button TabButton(string text, bool active)
    {
        var b = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            Font = TabFont,
            Height = 40,
            Width = 120,
            BackColor = Ui.Panel,
            ForeColor = active ? Ui.Amber : Ui.Ink,
            UseVisualStyleBackColor = false,
            AccessibleName = text,
        };
        b.FlatAppearance.BorderSize = 0;
        b.FlatAppearance.MouseOverBackColor = Ui.Line;
        return b;
    }

    internal static Button Action(string text)
    {
        var b = Ui.Primary(text);
        b.Font = Caption;
        b.Size = new Size(180, 38);
        return b;
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

    [DllImport("user32.dll")]
    static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
