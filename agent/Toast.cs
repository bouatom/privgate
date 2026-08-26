using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Topmost auto-closing notification. Balloon tips are silently suppressed by
/// Windows focus assist and while a fullscreen app is in the foreground -
/// exactly when JIT grants and approval decisions arrive - so important
/// notices also surface as a small always-on-top toast in the lower-right
/// working-area corner. Click anywhere on it to dismiss early.
/// </summary>
static class Toast
{
    static Form? _current;

    public static void Show(string title, string body)
    {
        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(body)) return;
        _current?.Close();
        var form = new Form
        {
            FormBorderStyle = FormBorderStyle.None,
            StartPosition = FormStartPosition.Manual,
            ShowInTaskbar = false,
            TopMost = true,
            BackColor = Ui.Panel,
            Size = new Size(380, 110),
            Font = new Font("Segoe UI", 9f),
        };
        var head = new Label
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Text = title,
            ForeColor = Ui.Amber,
            BackColor = Ui.Panel,
            Padding = new Padding(14, 10, 14, 2),
        };
        var text = new Label
        {
            Dock = DockStyle.Fill,
            Text = body,
            ForeColor = Ui.Ink,
            BackColor = Ui.Panel,
            Padding = new Padding(14, 4, 14, 10),
        };
        form.Controls.Add(text);
        form.Controls.Add(head);
        var area = Screen.PrimaryScreen.WorkingArea;
        form.Location = new Point(area.Right - form.Width - 16, area.Bottom - form.Height - 16);
        form.Click += (_, _) => form.Close();
        text.Click += (_, _) => form.Close();
        head.Click += (_, _) => form.Close();
        var autoClose = new System.Windows.Forms.Timer { Interval = 8000 };
        autoClose.Tick += (_, _) => form.Close();
        form.FormClosed += (_, _) =>
        {
            autoClose.Stop();
            autoClose.Dispose();
            if (_current == form) _current = null;
        };
        autoClose.Start();
        _current = form;
        form.Show();
    }
}
