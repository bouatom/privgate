using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

namespace PrivGate.Agent;

static class ElevationPrompt
{
    static int _lastConsentPid;
    static bool _busy;

    internal static void TickConsent()
    {
        if (_busy) return;
        var mine = Process.GetCurrentProcess().SessionId;
        foreach (var proc in Process.GetProcessesByName("consent"))
        {
            try
            {
                if (proc.SessionId != mine || proc.Id == _lastConsentPid) continue;
                _lastConsentPid = proc.Id;
                AskAfterUac();
                return;
            }
            catch
            {
                // Process may exit while we inspect it.
            }
        }
    }

    static void AskAfterUac()
    {
        var choice = MessageBox.Show(
            "Windows is asking for administrator permission. PrivGate can open the program on this desktop after an approver allows it — you do not need to sign out.\n\nRequest Disk Management now? Choose No to pick a different program.",
            "PrivGate",
            MessageBoxButtons.YesNoCancel,
            MessageBoxIcon.Information);
        if (choice == DialogResult.Cancel) return;
        if (choice == DialogResult.Yes)
        {
            Request(Path.Combine(Environment.SystemDirectory, "diskmgmt.msc"));
            return;
        }
        using var dlg = new OpenFileDialog
        {
            Title = "Choose a program to request through PrivGate",
            Filter = "Programs and snap-ins (*.exe;*.msc;*.msi)|*.exe;*.msc;*.msi|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (dlg.ShowDialog() == DialogResult.OK) Request(dlg.FileName);
    }

    internal static void Request(string path)
    {
        if (_busy)
        {
            MessageBox.Show("A PrivGate request is already waiting for approval.", "PrivGate");
            return;
        }
        _busy = true;
        var wait = new Form
        {
            Text = "PrivGate request",
            Size = new System.Drawing.Size(460, 160),
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
        };
        var label = new Label
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            Text = "Requesting " + path + "\n\nKeep this window open. If an approver allows it, the program opens here without signing out.",
        };
        wait.Controls.Add(label);
        wait.FormClosed += (_, _) => { _busy = false; };
        wait.Show();
        Task.Run(() =>
        {
            string reply;
            try { reply = ElevationClient.Request(path); }
            catch (Exception ex) { reply = JsonSerializer.Serialize(new { decision = "error", reason = ex.Message }); }
            try
            {
                wait.BeginInvoke(new Action(() =>
                {
                    label.Text = Summarize(reply);
                    wait.Text = "PrivGate request";
                }));
            }
            catch
            {
                _busy = false;
            }
        });
    }

    static string Summarize(string reply)
    {
        try
        {
            var json = JsonSerializer.Deserialize<JsonElement>(reply);
            var decision = json.TryGetProperty("decision", out var d) ? d.GetString() : "";
            var reason = json.TryGetProperty("reason", out var r) ? r.GetString() : "";
            if (decision == "allow") return "Approved. The program should be opening on this desktop.";
            if (decision == "deny") return "Denied. " + (reason ?? "");
            if (decision == "pending") return "Still waiting for an approver in the PrivGate console.";
            return string.IsNullOrWhiteSpace(reply) ? "No reply from the broker." : reply;
        }
        catch
        {
            return reply;
        }
    }
}
