using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Shared look &amp; feel for the client GUI, mirroring the management console
/// theme (src/app/globals.css dark palette): navy panels, light ink, amber accent.
/// </summary>
static class Ui
{
    public static readonly Color Bg = Hex("#101218");
    public static readonly Color Panel = Hex("#1B212C");
    public static readonly Color Line = Hex("#2C3545");
    public static readonly Color Ink = Hex("#E8EDF5");
    public static readonly Color Muted = Hex("#8B97AB");
    public static readonly Color Amber = Hex("#E0A14A");
    public static readonly Color AmberInk = Hex("#1A1208");
    public static readonly Color Ok = Hex("#4FBE8E");
    public static readonly Color Bad = Hex("#E06B5C");

    /// <summary>Base themed dialog: navy background, fixed size, centered.</summary>
    public static Form Dialog(string title, Size size)
    {
        return new Form
        {
            Text = title,
            Size = size,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            BackColor = Panel,
            ForeColor = Ink,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
            Font = new Font("Segoe UI", 9f),
        };
    }

    /// <summary>Body text on a themed dialog (light ink).</summary>
    public static Label Body(string text)
    {
        return new Label
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16, 14, 16, 6),
            Text = text,
            ForeColor = Ink,
            BackColor = Color.Transparent,
        };
    }

    /// <summary>Muted secondary text.</summary>
    public static Label Note(string text)
    {
        return new Label
        {
            Dock = DockStyle.Bottom,
            Height = 34,
            Padding = new Padding(16, 0, 16, 10),
            Text = text,
            ForeColor = Muted,
            BackColor = Color.Transparent,
        };
    }

    /// <summary>Amber primary action, like button.primary in the console.</summary>
    public static Button Primary(string text)
    {
        var b = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            BackColor = Amber,
            ForeColor = AmberInk,
            Size = new Size(120, 30),
            UseVisualStyleBackColor = false,
        };
        b.FlatAppearance.BorderColor = Amber;
        return b;
    }

    /// <summary>Quiet secondary action, like button.ghost in the console.</summary>
    public static Button Ghost(string text)
    {
        var b = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            BackColor = Panel,
            ForeColor = Ink,
            Size = new Size(100, 30),
            UseVisualStyleBackColor = false,
        };
        b.FlatAppearance.BorderColor = Line;
        return b;
    }

    static Color Hex(string html)
    {
        return ColorTranslator.FromHtml(html);
    }
}
