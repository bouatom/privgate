using System.Drawing;
using System.Drawing.Drawing2D;

namespace PrivGate.Agent;

/// <summary>Shared-silhouette icon states for the tray and windows.</summary>
internal enum AppIconState
{
    /// <summary>Healthy: amber shield on the navy tile.</summary>
    Normal,

    /// <summary>Attention: the same shield drawn in Ui.Bad red.</summary>
    Problem,
}

/// <summary>
/// PrivGate brand icon rendered at runtime with GDI+, reproducing the console
/// favicon (src/app/icon.svg): navy #101218 rounded tile (rx 14), amber shield,
/// navy keyhole cutout. Drawing instead of shipping binary assets keeps every
/// requested size crisp (16px tray vs 32/48px taskbar/DPI variants) with no new
/// dependencies. Colors come from Ui.* so palette stays 1:1 with the console.
/// </summary>
internal static class AppIcon
{
    public const int MinPx = 16;
    public const int MaxPx = 256;

    static readonly object Gate = new();
    static readonly Dictionary<(int Px, AppIconState State), Icon> Cache = new();

    /// <summary>Normal-state brand icon at the requested pixel size.</summary>
    public static Icon Create(int px) => Create(px, AppIconState.Normal);

    /// <summary>
    /// Cached brand icon at the requested pixel size (clamped 16..256).
    /// Instances are app-lifetime and shared: callers must not dispose them —
    /// NotifyIcon/Form.Icon only drop their reference while the shell may
    /// still hold the HICON, and the handful of small bitmaps involved are
    /// reclaimed by the OS at process exit.
    /// </summary>
    public static Icon Create(int px, AppIconState state)
    {
        var size = Math.Max(MinPx, Math.Min(MaxPx, px));
        lock (Gate)
        {
            if (Cache.TryGetValue((size, state), out var cached)) return cached;
            var made = Render(size, state);
            Cache[(size, state)] = made;
            return made;
        }
    }

    static Icon Render(int px, AppIconState state)
    {
        using var bmp = new Bitmap(px, px);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            DrawTile(g, px);
            using (var shield = ShieldPath(px))
            using (var shieldFill = new SolidBrush(state == AppIconState.Problem ? Ui.Bad : Ui.Amber))
            using (var cutout = new SolidBrush(Ui.Bg))
            {
                g.FillPath(shieldFill, shield);
                DrawKeyhole(g, px, cutout);
            }
        }
        // GetHicon copies the pixels out; the returned wrapper's handle is
        // owned by the cache (see Create).
        return Icon.FromHandle(bmp.GetHicon());
    }

    static PointF P(int px, float x, float y) => new(x * px / 64f, y * px / 64f);

    /// <summary>The icon.svg 64×64 tile: full-canvas rounded square, rx 14.</summary>
    static void DrawTile(Graphics g, int px)
    {
        float s = px / 64f, r = 14f * s, w = 64f * s;
        using var path = new GraphicsPath();
        path.AddArc(0, 0, 2 * r, 2 * r, 180, 90);
        path.AddArc(w - 2 * r, 0, 2 * r, 2 * r, 270, 90);
        path.AddArc(w - 2 * r, w - 2 * r, 2 * r, 2 * r, 0, 90);
        path.AddArc(0, w - 2 * r, 2 * r, 2 * r, 90, 90);
        path.CloseFigure();
        using var brush = new SolidBrush(Ui.Bg);
        g.FillPath(brush, path);
    }

    /// <summary>
    /// Shield outline from icon.svg ("M32 9l19 7.2V30c0 12.6-8.3 20-19
    /// 24.5C21.3 50 13 42.6 13 30V16.2z"): two edges as lines, the skirt as
    /// the SVG's two cubic béziers, verbatim control points.
    /// </summary>
    static GraphicsPath ShieldPath(int px)
    {
        var path = new GraphicsPath();
        path.AddLines(new[] { P(px, 32, 9), P(px, 51, 16.2f), P(px, 51, 30) });
        path.AddBezier(P(px, 51, 30), P(px, 51, 42.6f), P(px, 42.7f, 50), P(px, 32, 54.5f));
        path.AddBezier(P(px, 32, 54.5f), P(px, 21.3f, 50), P(px, 13, 42.6f), P(px, 13, 30));
        path.AddLine(P(px, 13, 30), P(px, 13, 16.2f));
        path.CloseFigure();
        return path;
    }

    /// <summary>Keyhole cutout, painted in tile navy like the SVG layers.</summary>
    static void DrawKeyhole(Graphics g, int px, Brush cut)
    {
        float s = px / 64f;
        // Circle cx32 cy26.5 r5.5.
        g.FillEllipse(cut, (32f - 5.5f) * s, (26.5f - 5.5f) * s, 11f * s, 11f * s);

        // Stem: rect 29.8..34.2 × 30..43.5 closed by the SVG's r2.2 bottom cap.
        using (var stem = new GraphicsPath())
        {
            stem.AddLines(new[] { P(px, 29.8f, 30), P(px, 34.2f, 30), P(px, 34.2f, 43.5f) });
            stem.AddArc((32f - 2.2f) * s, (43.5f - 2.2f) * s, 4.4f * s, 4.4f * s, 0f, 180f);
            stem.CloseFigure(); // vertical back up to (29.8, 30)
            g.FillPath(cut, stem);
        }

        // Notch: rect 33.6..40.6 × 37.5..41.1 plus its r1.8 right cap
        // (cap center sits at 40.6, so the arc box starts at 40.6 − 1.8).
        using (var notch = new GraphicsPath())
        {
            notch.AddLines(new[] { P(px, 33.6f, 37.5f), P(px, 40.6f, 37.5f) });
            notch.AddArc((40.6f - 1.8f) * s, 37.5f * s, 3.6f * s, 3.6f * s, -90f, 180f);
            notch.AddLine(P(px, 40.6f, 41.1f), P(px, 33.6f, 41.1f));
            notch.CloseFigure();
            g.FillPath(cut, notch);
        }
    }
}
