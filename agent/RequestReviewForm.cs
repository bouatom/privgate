using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Review step between choosing a program and submitting the elevation
/// request. Shows what the binary claims to be (description, publisher,
/// version), where it lives, and its SHA-256 — so users can confirm they are
/// elevating the right thing, and approvers get a request the submitter
/// actually understood. Every submission path goes through here: tray menu,
/// UAC-cancel with a known target, UAC-cancel browse.
/// </summary>
static class RequestReviewForm
{
    /// <summary>
    /// Shows program details for <paramref name="path"/> and asks for
    /// confirmation. Returns true only when the user pressed Send request.
    /// </summary>
    internal static bool Confirm(string path)
    {
        var info = Describe(path);
        using var dlg = Ui.Dialog("PrivGate request", new Size(520, 330));
        var body = Ui.Body(
            "Send an elevation request for this program?\n\n" +
            "Program: " + info.Name + "\n" +
            "Publisher: " + info.Publisher + "\n" +
            "Version: " + info.Version + "\n" +
            "Location: " + path,
            "Program details");
        var hash = Ui.Note("SHA-256: calculating…", "Program SHA-256");
        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 48,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(12),
            BackColor = Color.Transparent,
        };
        var send = Ui.Primary("Send request");
        var cancel = Ui.Ghost("Cancel");
        send.Click += (_, _) => { dlg.DialogResult = DialogResult.OK; dlg.Close(); };
        cancel.Click += (_, _) => { dlg.DialogResult = DialogResult.Cancel; dlg.Close(); };
        buttons.Controls.Add(send);
        buttons.Controls.Add(cancel);
        dlg.Controls.Add(body);
        dlg.Controls.Add(hash);
        dlg.Controls.Add(buttons);
        dlg.AcceptButton = send;   // Enter → primary action
        dlg.CancelButton = cancel; // Esc → least destructive

        // The hash is the exact identity an approver allowlists against, but
        // hashing can take a moment on large installers — compute off the UI
        // thread and fill in when ready.
        Task.Run(() =>
        {
            try
            {
                var sha = Authenticode.Sha256File(path);
                dlg.BeginInvoke(new Action(() => hash.Text = "SHA-256: " + sha));
            }
            catch
            {
                dlg.BeginInvoke(new Action(() => hash.Text = "SHA-256: unavailable (file could not be read)"));
            }
        });

        return dlg.ShowDialog() == DialogResult.OK;
    }

    static (string Name, string Publisher, string Version) Describe(string path)
    {
        var fallback = System.IO.Path.GetFileName(path);
        var name = fallback;
        var publisher = "Unknown publisher";
        var version = "";
        try
        {
            var vi = FileVersionInfo.GetVersionInfo(path);
            if (!string.IsNullOrWhiteSpace(vi.FileDescription)) name = vi.FileDescription.Trim();
            else if (!string.IsNullOrWhiteSpace(vi.ProductName)) name = vi.ProductName.Trim();
            if (!string.IsNullOrWhiteSpace(vi.CompanyName)) publisher = vi.CompanyName.Trim();
            if (!string.IsNullOrWhiteSpace(vi.FileVersion)) version = vi.FileVersion.Trim();
        }
        catch
        {
            // Missing or unreadable version resource: keep file-name fallbacks.
        }
        return (name, publisher, version);
    }
}
