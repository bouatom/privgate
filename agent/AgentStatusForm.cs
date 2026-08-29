using System.Drawing;
using System.Windows.Forms;

namespace PrivGate.Agent;

/// <summary>
/// Agent window: JIT on the home surface, System and Requests as tabs,
/// borderless muted chrome (no OS white title bar).
/// </summary>
sealed class AgentStatusForm : Form
{
    readonly Label _jitState = new()
    {
        Font = AgentChrome.Hero,
        ForeColor = Ui.Ink,
        AutoSize = true,
        Location = new Point(20, 16),
        AccessibleName = "JIT status",
    };
    readonly Label _jitUntil = new()
    {
        Font = AgentChrome.Body,
        ForeColor = Ui.Muted,
        AutoSize = true,
        Location = new Point(20, 52),
        MaximumSize = new Size(560, 0),
        AccessibleName = "JIT time",
    };
    readonly Button _tabSystem;
    readonly Button _tabRequests;
    readonly AgentSystemPage _system = new();
    readonly AgentRequestsPage _requests = new();
    Panel? _pages;

    public AgentStatusForm()
    {
        Text = "PrivGate Agent";
        MinimumSize = new Size(620, 520);
        Size = new Size(660, 560);
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

        _tabSystem = AgentChrome.TabButton("System", active: true);
        _tabRequests = AgentChrome.TabButton("Requests", active: false);
        _tabSystem.Click += (_, _) => ShowTab(system: true);
        _tabRequests.Click += (_, _) => ShowTab(system: false);

        Controls.Add(Pages());
        Controls.Add(TabBar());
        Controls.Add(JitHero());
        Controls.Add(AgentChrome.CaptionBar(this, "PrivGate Agent", Hide));
        ShowTab(system: true);
    }

    Control JitHero()
    {
        var hero = new Panel { Dock = DockStyle.Top, Height = 100, BackColor = Ui.Bg };
        var cap = new Label
        {
            Text = "JIT ADMIN",
            Font = AgentChrome.Caption,
            ForeColor = Ui.Muted,
            AutoSize = true,
            Location = new Point(20, 10),
            AccessibleName = "JIT admin",
        };
        hero.Controls.Add(_jitUntil);
        hero.Controls.Add(_jitState);
        hero.Controls.Add(cap);
        hero.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
        return hero;
    }

    Control TabBar()
    {
        var bar = new Panel { Dock = DockStyle.Top, Height = 48, BackColor = Ui.Panel };
        _tabSystem.Location = new Point(12, 4);
        _tabRequests.Location = new Point(140, 4);
        bar.Controls.Add(_tabRequests);
        bar.Controls.Add(_tabSystem);
        bar.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
        return bar;
    }

    Control Pages()
    {
        _pages = new Panel { Dock = DockStyle.Fill, BackColor = Ui.Panel };
        _pages.Controls.Add(_requests);
        _pages.Controls.Add(_system);
        return _pages;
    }

    void ShowTab(bool system)
    {
        _system.Visible = system;
        _requests.Visible = !system;
        _tabSystem.ForeColor = system ? Ui.Amber : Ui.Ink;
        _tabRequests.ForeColor = system ? Ui.Ink : Ui.Amber;
        if (_pages != null)
        {
            if (system) _system.BringToFront();
            else _requests.BringToFront();
        }
    }

    public void Bind(StatusSnapshot snap)
    {
        if (snap.JitActive)
        {
            _jitState.Text = "On";
            _jitState.ForeColor = Ui.Ok;
            _jitUntil.Text = string.IsNullOrEmpty(snap.JitUntil)
                ? "Temporary admin rights are active."
                : "Until " + snap.JitUntil;
        }
        else
        {
            _jitState.Text = "Off";
            _jitState.ForeColor = Ui.Muted;
            _jitUntil.Text = "No temporary admin window on this PC.";
        }
        _system.Bind(snap);
        _requests.Bind(snap);
    }
}
