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
    // Agent-local derived tone for secondary-but-important lines (error detail
    // under a friendly headline). Not a console token: src/app/globals.css is
    // untouched; the hexes above stay 1:1 with the console dark palette.
    public static readonly Color MutedStrong = Hex("#A5B1C4");
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
            // Fullscreen apps (games, kiosks) hide normal dialogs entirely;
            // prompts must be answerable no matter what is in the foreground.
            TopMost = true,
            Font = new Font("Segoe UI", 9f),
        };
    }

    /// <summary>
    /// Body text on a themed dialog (light ink — primary reading text).
    /// Pass accessibleName when the text is long or dynamic.
    /// </summary>
    public static Label Body(string text, string? accessibleName = null)
    {
        return new Label
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16, 14, 16, 6),
            Text = text,
            ForeColor = Ink,
            BackColor = Color.Transparent,
            AccessibleName = accessibleName ?? text,
        };
    }

    /// <summary>
    /// Muted secondary text. AutoSizes so scaled/localized strings are never
    /// clipped by a fixed height; docked Bottom keeps it full dialog width.
    /// </summary>
    public static Label Note(string text, string? accessibleName = null)
    {
        return new Label
        {
            Dock = DockStyle.Bottom,
            AutoSize = true,
            Padding = new Padding(16, 0, 16, 10),
            Text = text,
            ForeColor = Muted,
            BackColor = Color.Transparent,
            AccessibleName = accessibleName ?? text,
        };
    }

    /// <summary>
    /// Dialog heading, like the console's card titles: larger bold ink text
    /// for the top of a themed window. Pass accessibleName when dynamic.
    /// </summary>
    public static Label Title(string text, string? accessibleName = null)
    {
        return new Label
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Padding = new Padding(16, 14, 16, 2),
            Text = text,
            ForeColor = Ink,
            BackColor = Color.Transparent,
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            AccessibleName = accessibleName ?? text,
        };
    }

    /// <summary>
    /// Small muted uppercase microcopy, like .nav-section-label / .card .k in
    /// the console. WinForms labels cannot letter-space, so uppercase + the
    /// small size carry the idiom alone.
    /// </summary>
    public static Label SectionLabel(string text, string? accessibleName = null)
    {
        var upper = text.ToUpperInvariant();
        return new Label
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Padding = new Padding(16, 10, 16, 2),
            Text = upper,
            ForeColor = Muted,
            BackColor = Color.Transparent,
            // 8.25pt == the console's 11px at standard DPI; scales with system DPI.
            Font = new Font("Segoe UI", 8.25f),
            AccessibleName = accessibleName ?? upper,
        };
    }

    /// <summary>
    /// 1px separator in the Line tone between dialog sections, like the
    /// console's border tokens. Docks Bottom by default; move it as needed.
    /// </summary>
    public static Panel Hairline(string? accessibleName = null)
    {
        return new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 1,
            BackColor = Line,
            AccessibleName = accessibleName ?? "Separator",
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
        // Manual parse instead of ColorTranslator.FromHtml: a throwing static
        // initializer would poison every later Ui.* call for the life of the
        // process (TypeInitializationException), which reads as "no GUI".
        var value = html.TrimStart('#');
        if (value.Length == 6 && TryParseHex(value, out var rgb))
        {
            return Color.FromArgb((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
        }
        return SystemColors.Control;
    }

    static bool TryParseHex(string text, out int rgb)
    {
        rgb = 0;
        foreach (var c in text)
        {
            var digit = c >= '0' && c <= '9' ? c - '0'
                : c >= 'a' && c <= 'f' ? c - 'a' + 10
                : c >= 'A' && c <= 'F' ? c - 'A' + 10
                : -1;
            if (digit < 0) return false;
            rgb = (rgb << 4) | digit;
        }
        return true;
    }
}
