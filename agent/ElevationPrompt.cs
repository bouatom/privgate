using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Windows.Forms;

namespace PrivGate.Agent;

static class ElevationPrompt
{
    static readonly ConsentWatch Watch = new();
    static bool _busy;
    static bool _promptOpen;
    static bool _uacVisible;
    static string _pendingTarget = "";

    internal static void TickConsent()
    {
        if (_busy || _promptOpen) return;
        try
        {
            RunTick();
        }
        catch (Exception ex)
        {
            // One bad tick (process enumeration hiccup, dialog construction,
            // themed-paint failure) must not end consent watching: log, reset
            // the open-dialog guard, let the next tick retry.
            _promptOpen = false;
            _pendingTarget = "";
            BrokerLog.Write("uac watch tick failed: " + ex);
        }
    }

    static void RunTick()
    {
        ForegroundTracker.Start();
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
        var visible = pids.Count > 0;
        if (visible && !_uacVisible) _pendingTarget = ForegroundTracker.Candidate();
        _uacVisible = visible;
        if (!Watch.ShouldPrompt(pids)) return;
        BrokerLog.Write(_pendingTarget.Length > 0
            ? "uac.closed — offering PrivGate request for " + _pendingTarget
            : "uac.closed — offering PrivGate request (program unidentified)");
        _promptOpen = true;
        try
        {
            ElevationClient.ReportCanceled(_pendingTarget);
            AskAfterUac(_pendingTarget);
        }
        finally
        {
            _promptOpen = false;
            _pendingTarget = "";
        }
    }

    /// <summary>
    /// After the stock UAC closes: when we identified the program, offer a one-click
    /// request for it; otherwise fall back to the pick-your-program flow.
    /// </summary>
    static void AskAfterUac(string target)
    {
        if (target.Length > 0)
        {
            using var dlg = Ui.Dialog("PrivGate", new Size(480, 210));
            dlg.Controls.Add(Ui.Note("An approver can allow it without an admin password."));
            var body = Ui.Body(
                "Windows asked for administrator approval and the prompt was closed.\n\n" +
                "Submit a PrivGate request for\n" + target + "?");
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                Height = 44,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(12),
                BackColor = Color.Transparent,
            };
            var yes = Ui.Primary("Request it");
            var no = Ui.Ghost("Not now");
            yes.Click += (_, _) => { dlg.DialogResult = DialogResult.Yes; dlg.Close(); };
            no.Click += (_, _) => { dlg.DialogResult = DialogResult.No; dlg.Close(); };
            buttons.Controls.Add(yes);
            buttons.Controls.Add(no);
            dlg.Controls.Add(buttons);
            if (dlg.ShowDialog() == DialogResult.Yes) Request(target);
            return;
        }

        using var ask = Ui.Dialog("PrivGate", new Size(480, 210));
        var askBody = Ui.Body(
            "Windows asked for administrator approval and the prompt was closed.\n\n" +
            "Which program did you try to open?");
        ask.Controls.Add(askBody);
        ask.Controls.Add(Ui.Note("An approver can allow it without an admin password."));
        var askButtons = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 44,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(12),
            BackColor = Color.Transparent,
        };
        var disk = Ui.Primary("Request Disk Management");
        var browse = Ui.Ghost("Browse for the program…");
        var later = Ui.Ghost("Not now");
        disk.AutoSize = true;
        browse.AutoSize = true;
        later.AutoSize = true;
        disk.Click += (_, _) => { ask.DialogResult = DialogResult.Yes; ask.Close(); };
        browse.Click += (_, _) => { ask.DialogResult = DialogResult.No; ask.Close(); };
        later.Click += (_, _) => { ask.DialogResult = DialogResult.Cancel; ask.Close(); };
        askButtons.Controls.Add(disk);
        askButtons.Controls.Add(browse);
        askButtons.Controls.Add(later);
        ask.Controls.Add(askButtons);
        var choice = ask.ShowDialog();
        if (choice == DialogResult.Yes)
        {
            Request(Path.Combine(Environment.SystemDirectory, "diskmgmt.msc"));
            return;
        }
        if (choice != DialogResult.No) return;
        using var picker = new OpenFileDialog
        {
            Title = "Choose the program Windows just blocked",
            Filter = "Programs and snap-ins (*.exe;*.msc;*.msi)|*.exe;*.msc;*.msi|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (picker.ShowDialog() == DialogResult.OK) Request(picker.FileName);
    }

    internal static void Request(string path)
    {
        if (_busy)
        {
            MessageBox.Show("A PrivGate request is already waiting for approval.", "PrivGate");
            return;
        }
        _busy = true;
        var wait = Ui.Dialog("PrivGate request", new Size(460, 190));
        var label = Ui.Body(
            "Requesting " + path + "\n\nIf an approver allows it, the program opens here without signing out." +
            "\n\nYou can close this window — we will notify you when a decision arrives.");
        wait.Controls.Add(label);
        var elapsed = Ui.Note("Waiting 0:00…");
        wait.Controls.Add(elapsed);
        var started = Stopwatch.StartNew();
        const int timeoutSeconds = 16 * 60;
        var ticker = new System.Windows.Forms.Timer { Interval = 1000 };
        ticker.Tick += (_, _) =>
        {
            var secs = (int)Math.Min(started.Elapsed.TotalSeconds, timeoutSeconds);
            elapsed.Text = $"Waiting {secs / 60}:{secs % 60:D2}…";
        };
        ticker.Start();
        var open = true;
        wait.FormClosed += (_, _) => { open = false; ticker.Stop(); ticker.Dispose(); _busy = false; };
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
                    if (!open) return;
                    ticker.Stop();
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
