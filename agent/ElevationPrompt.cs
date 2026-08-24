using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

namespace PrivGate.Agent;

static class ElevationPrompt
{
    static readonly ConsentWatch Watch = new();
    static bool _busy;
    static bool _promptOpen;

    internal static void TickConsent()
    {
        if (_busy || _promptOpen) return;
        var mine = Process.GetCurrentProcess().SessionId;
        var pids = new List<int>();
        foreach (var proc in Process.GetProcessesByName("consent"))
        {
            try
            {
                if (proc.SessionId == mine) pids.Add(proc.Id);
            }
            catch
            {
                // Process may exit while we inspect it.
            }
        }
        if (!Watch.ShouldPrompt(pids)) return;
        BrokerLog.Write("uac.closed — offering PrivGate request (Windows prompt ended; not intercepted)");
        _promptOpen = true;
        try { AskAfterUac(); }
        finally { _promptOpen = false; }
    }

    static void AskAfterUac()
    {
        var choice = MessageBox.Show(
            "The Windows administrator prompt has closed. If you cancelled it, PrivGate can request that program for you. An approver can allow it without an admin password, and it will open on this desktop.\n\nWindows does not tell PrivGate which file you tried. Request Disk Management now? Choose No to pick the program yourself.",
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
            Title = "Choose the program Windows just blocked",
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
