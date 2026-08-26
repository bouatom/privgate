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
    // Exact program paths read from consent.exe command lines while the UAC
    // prompt was open (broker resolves them as SYSTEM). Preferred over the
    // foreground-tracker guess, which lags behind right-click menus and often
    // names the previous request's program.
    static volatile string[] _consentTargets = Array.Empty<string>();

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
        if (visible && !_uacVisible)
        {
            _pendingTarget = ForegroundTracker.Candidate();
            // The prompt just appeared: ask the broker (SYSTEM) to read the
            // consent.exe command lines now, while they are alive, so the
            // exact target is known by the time the prompt closes.
            var snapshot = pids.ToArray();
            Task.Run(() =>
            {
                try
                {
                    var targets = ElevationClient.ConsentTargets(snapshot);
                    if (targets.Length > 0) _consentTargets = targets;
                }
                catch
                {
                    // Foreground fallback still applies when this fails.
                }
            });
        }
        _uacVisible = visible;
        if (!Watch.ShouldPrompt(pids)) return;
        _promptOpen = true;
        try
        {
            // Exact capture beats the foreground guess.
            if (_consentTargets.Length > 0) _pendingTarget = _consentTargets[0];
            // Classify BEFORE reporting: consent closing does not mean the
            // prompt was dismissed. An administrator who approved their own
            // prompt must not get a fake "canceled" row or the follow-up nag.
            var outcome = ClassifyClosedPrompt();
            if (outcome == UacOutcome.ApprovedSelf || outcome == UacOutcome.ApprovedOther)
            {
                ElevationClient.ReportCanceled(_pendingTarget, UacClassifier.Wire(outcome));
                return;
            }
            BrokerLog.Write(_pendingTarget.Length > 0
                ? "uac.closed — offering PrivGate request for " + _pendingTarget
                : "uac.closed — offering PrivGate request (program unidentified)");
            ElevationClient.ReportCanceled(_pendingTarget);
            AskAfterUac(_pendingTarget);
        }
        finally
        {
            _promptOpen = false;
            _pendingTarget = "";
            _consentTargets = Array.Empty<string>();
        }
    }

    /// <summary>
    /// Asks the broker service to classify the just-closed prompt; Unknown on
    /// any failure so the legacy flow still runs.
    /// </summary>
    static UacOutcome ClassifyClosedPrompt()
    {
        var outcome = ElevationClient.ClassifyClosedPrompt(
            _pendingTarget,
            System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value ?? "",
            Process.GetCurrentProcess().SessionId);
        BrokerLog.Write("uac.classified outcome=" + UacClassifier.Wire(outcome) +
            " target=" + (_pendingTarget.Length > 0 ? _pendingTarget : "(unidentified program)"));
        return outcome;
    }

    /// <summary>
    /// After the stock UAC closes: when we identified the program, offer a one-click
    /// request for it; otherwise fall back to the pick-your-program flow.
    /// </summary>
    static void AskAfterUac(string target)
    {
        if (target.Length > 0)
        {
            // Straight to the review window: the user just cancelled UAC for
            // THIS program, so an extra "do you want to request it?" step only
            // adds delay between the cancel and the ask.
            if (RequestReviewForm.Confirm(target)) Request(target);
            return;
        }

        using var ask = Ui.Dialog("PrivGate", new Size(480, 210));
        var askBody = Ui.Body(
            "Windows asked for administrator approval and the prompt was closed.\n\n" +
            "Which program did you try to open?", "Choose the program to request");
        ask.Controls.Add(askBody);
        ask.Controls.Add(Ui.Note("An approver can allow it without an admin password.", "Approver hint"));
        var askButtons = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 44,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(12),
            BackColor = Color.Transparent,
        };
        var browse = Ui.Primary("Browse for the program…");
        var later = Ui.Ghost("Not now");
        browse.AutoSize = true;
        later.AutoSize = true;
        browse.Click += (_, _) => { ask.DialogResult = DialogResult.OK; ask.Close(); };
        later.Click += (_, _) => { ask.DialogResult = DialogResult.Cancel; ask.Close(); };
        askButtons.Controls.Add(browse);
        askButtons.Controls.Add(later);
        ask.Controls.Add(askButtons);
        ask.AcceptButton = browse; // Enter → primary action
        ask.CancelButton = later;  // Esc → least destructive ("Not now")
        if (ask.ShowDialog() != DialogResult.OK) return;
        using var picker = new OpenFileDialog
        {
            Title = "Choose the program Windows just blocked",
            Filter = "Programs and snap-ins (*.exe;*.msc;*.msi)|*.exe;*.msc;*.msi|All files (*.*)|*.*",
            CheckFileExists = true,
        };
        if (picker.ShowDialog() == DialogResult.OK && RequestReviewForm.Confirm(picker.FileName))
        {
            Request(picker.FileName);
        }
    }

    /// <summary>
    /// Themed notice that a request is already pending. Any failure in themed
    /// construction or display falls back to the plain OS MessageBox — losing
    /// the styling is harmless, breaking the consent-watching flow is not.
    /// </summary>
    static void ShowAlreadyWaiting()
    {
        try
        {
            using var dlg = Ui.Dialog("PrivGate", new Size(420, 170));
            dlg.Controls.Add(Ui.Body(
                "A PrivGate request is already waiting for approval.",
                "Request already waiting"));
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                Height = 44,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(12),
                BackColor = Color.Transparent,
            };
            var ok = Ui.Primary("OK");
            ok.Click += (_, _) => { dlg.DialogResult = DialogResult.OK; dlg.Close(); };
            buttons.Controls.Add(ok);
            dlg.Controls.Add(buttons);
            dlg.AcceptButton = ok; // Enter → dismiss
            dlg.CancelButton = ok; // Esc → dismiss
            dlg.ShowDialog();
        }
        catch (Exception ex)
        {
            BrokerLog.Write("themed already-waiting dialog failed: " + ex);
            MessageBox.Show("A PrivGate request is already waiting for approval.", "PrivGate");
        }
    }

    internal static void Request(string path)
    {
        if (_busy)
        {
            ShowAlreadyWaiting();
            return;
        }
        _busy = true;
        var wait = Ui.Dialog("PrivGate request", new Size(460, 190));
        var label = Ui.Body(
            "Requesting " + path + "\n\nIf an approver allows it, the program opens here without signing out." +
            "\n\nYou can close this window — we will notify you when a decision arrives.", "Request status");
        wait.Controls.Add(label);
        var elapsed = Ui.Note("Waiting 0:00…", "Elapsed wait time");
        wait.Controls.Add(elapsed);
        // Invisible Esc sink: the window has no visible buttons, but Esc must
        // still dismiss it (closing is safe — the request keeps waiting).
        var esc = new Button { Visible = false, AccessibleName = "Dismiss wait window" };
        esc.Click += (_, _) => wait.Close();
        wait.Controls.Add(esc);
        wait.CancelButton = esc;
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
                    var primary = Summarize(reply, out var detail);
                    label.Text = primary;
                    if (detail.Length > 0)
                    {
                        // Raw detail stays secondary: muted-strong line under
                        // the friendly headline, JSON syntax stripped.
                        elapsed.Text = "Details: " + detail;
                        elapsed.ForeColor = Ui.MutedStrong;
                    }
                    else
                    {
                        elapsed.Text = "";
                    }
                    wait.Text = "PrivGate request";
                }));
            }
            catch
            {
                _busy = false;
            }
        });
    }

    /// <summary>
    /// Turns a broker reply into human copy. The primary text is always
    /// friendly; anything raw (error reason, unparsable reply) goes to
    /// <paramref name="detail"/> and is rendered as a muted secondary line —
    /// never braces or JSON syntax on screen.
    /// </summary>
    static string Summarize(string reply, out string detail)
    {
        detail = "";
        var shape = "empty";
        var reason = "";
        try
        {
            var json = JsonSerializer.Deserialize<JsonElement>(reply);
            shape = json.TryGetProperty("decision", out var d) ? d.GetString() ?? "" : "";
            reason = json.TryGetProperty("reason", out var r) ? r.GetString() ?? "" : "";
        }
        catch
        {
            shape = "";
            reason = reply;
        }
        switch (shape)
        {
            case "allow": return "Approved. The program should be opening on this desktop.";
            case "deny":
                return "Denied. " + (string.IsNullOrWhiteSpace(reason) ? "The request was denied." : reason);
            case "pending": return "Still waiting for an approver in the PrivGate console.";
            case "error":
                detail = CleanDetail(reason);
                if (IsTimeout(reason))
                {
                    return "No one approved within 16 minutes - try again or contact IT.";
                }
                return "PrivGate could not reach its helper - try again, or contact IT if it keeps happening.";
            default:
                // Unknown shape or non-JSON garbage: same generic failure copy,
                // with whatever came back preserved as the secondary line.
                detail = string.IsNullOrWhiteSpace(reply) ? "" : CleanDetail(reply);
                if (detail.Length == 0) detail = "no reply from the broker";
                return "PrivGate could not reach its helper - try again, or contact IT if it keeps happening.";
        }
    }

    static bool IsTimeout(string reason)
    {
        var r = (reason ?? "").ToLowerInvariant();
        return r.Contains("timeout") || r.Contains("timed out") || r.Contains("expired");
    }

    /// <summary>Strips JSON syntax characters so raw detail never shows braces.</summary>
    static string CleanDetail(string raw)
    {
        var text = (raw ?? "").Replace("{", "").Replace("}", "").Replace("\"", "").Trim();
        return text.Length <= 300 ? text : text.Substring(0, 300);
    }
}
