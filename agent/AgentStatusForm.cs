using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Agent window: brand caption with live status, compact JIT strip,
/// System / Requests tabs with an amber active rail.
/// </summary>
sealed class AgentStatusForm : Form
{
    readonly AgentCaption _caption;
    readonly Label _jitState;
    readonly Label _jitUntil;
    readonly Panel _jitRail;
    readonly Button _tabSystem;
    readonly Button _tabRequests;
    readonly Panel _systemRail;
    readonly Panel _requestsRail;
    readonly Label _requestsCount;
    readonly AgentSystemPage _system = new();
    readonly AgentRequestsPage _requests = new();
    Panel? _pages;

    public AgentStatusForm()
    {
        Text = "PrivGate Agent";
        MinimumSize = new Size(680, 540);
        Size = new Size(720, 580);
        Icon = AppIcon.Create(32);
        AgentChrome.Apply(this);
        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };

        _caption = AgentChrome.CaptionBar(this, Hide);
        _jitRail = new Panel { Width = 2, Height = 48, Location = new Point(20, 10), BackColor = Ui.Line };
        _jitState = AgentWidgets.Pill("Not active", Ui.Muted, Ui.Line);
        _jitState.Location = new Point(40, 12);
        _jitUntil = new Label
        {
            Font = AgentChrome.Caption,
            ForeColor = Ui.Muted,
            AutoSize = true,
            Location = new Point(40, 38),
            MaximumSize = new Size(620, 0),
            BackColor = Color.Transparent,
            AccessibleName = "Temporary admin time",
        };

        _tabSystem = AgentChrome.TabButton("System", active: true);
        _tabRequests = AgentChrome.TabButton("Requests", active: false);
        _tabSystem.Click += (_, _) => ShowTab(system: true);
        _tabRequests.Click += (_, _) => ShowTab(system: false);
        _systemRail = new Panel { Width = 128, Height = 2, BackColor = Ui.Amber };
        _requestsRail = new Panel { Width = 128, Height = 2, BackColor = Color.Transparent };
        _requestsCount = AgentWidgets.Pill("0", Ui.Amber2, Ui.PillPendingLine);
        _requestsCount.Visible = false;

        Controls.Add(Pages());
        Controls.Add(TabBar());
        Controls.Add(JitStrip());
        Controls.Add(_caption.Bar);
        ShowTab(system: true);
    }

    Control JitStrip()
    {
        var strip = new Panel { Dock = DockStyle.Top, Height = 64, BackColor = Color.Transparent };
        var cap = AgentWidgets.MicroText("Temporary admin", "Temporary admin");
        cap.Location = new Point(40, 8);
        _jitState.Location = new Point(168, 6);
        strip.Controls.Add(_jitUntil);
        strip.Controls.Add(_jitState);
        strip.Controls.Add(cap);
        strip.Controls.Add(_jitRail);
        strip.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
        return strip;
    }

    Control TabBar()
    {
        var bar = new Panel { Dock = DockStyle.Top, Height = 44, BackColor = Color.Transparent };
        _tabSystem.Location = new Point(12, 2);
        _tabRequests.Location = new Point(140, 2);
        _systemRail.Location = new Point(12, 42);
        _requestsRail.Location = new Point(140, 42);
        _requestsCount.Location = new Point(268, 10);
        bar.Controls.Add(_requestsCount);
        bar.Controls.Add(_requestsRail);
        bar.Controls.Add(_systemRail);
        bar.Controls.Add(_tabRequests);
        bar.Controls.Add(_tabSystem);
        bar.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
        return bar;
    }

    Control Pages()
    {
        _pages = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent, Padding = new Padding(16, 12, 16, 16) };
        _pages.Controls.Add(_requests);
        _pages.Controls.Add(_system);
        return _pages;
    }

    void ShowTab(bool system)
    {
        _system.Visible = system;
        _requests.Visible = !system;
        _tabSystem.ForeColor = system ? Ui.Ink : Ui.Muted;
        _tabRequests.ForeColor = system ? Ui.Muted : Ui.Ink;
        _systemRail.BackColor = system ? Ui.Amber : Color.Transparent;
        _requestsRail.BackColor = system ? Color.Transparent : Ui.Amber;
        if (_pages != null)
        {
            if (system) _system.BringToFront();
            else _requests.BringToFront();
        }
    }

    public void Bind(StatusSnapshot snap)
    {
        _caption.BindLive(snap.Realtime);
        if (snap.JitActive)
        {
            _jitState.Text = "ACTIVE";
            _jitState.ForeColor = Ui.Ok;
            _jitState.Tag = Ui.PillOkLine;
            _jitState.Invalidate();
            _jitRail.BackColor = Ui.Ok;
            _jitUntil.Text = string.IsNullOrEmpty(snap.JitUntil)
                ? "Temporary admin rights are on this PC."
                : "Until " + snap.JitUntil;
            _jitUntil.ForeColor = Ui.Ink;
        }
        else
        {
            _jitState.Text = "NOT ACTIVE";
            _jitState.ForeColor = Ui.Muted;
            _jitState.Tag = Ui.Line;
            _jitState.Invalidate();
            _jitRail.BackColor = Ui.Line;
            _jitUntil.Text = "No temporary admin window.";
            _jitUntil.ForeColor = Ui.Muted;
        }
        var pending = !string.IsNullOrEmpty(snap.Pending);
        _requestsCount.Visible = pending;
        if (pending) _requestsCount.Text = "1";
        _system.Bind(snap);
        _requests.Bind(snap);
    }
}
