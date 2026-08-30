import Link from "next/link";
import type { ReactNode } from "react";
import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { displayPath } from "@/lib/format";
import { dashboardPayload } from "@/lib/metrics";
import { Forbidden } from "../forbidden";

/* Stat-card glyphs — same 17px stroke pattern as the side-nav icons.
   Nav-matching shapes (inbox/clock/monitor/shield) are reused verbatim so a
   card visually echoes the section it links to. */
const ICONS = {
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  checkCircle: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 1.5" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  timer: (
    <>
      <path d="M10 2h4M12 14l3-3" />
      <circle cx="12" cy="14" r="8" />
    </>
  ),
  network: (
    <>
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <path d="M12 8v4M5 16v-3h14v3" />
    </>
  ),
} as const;

function StatIcon({ shape }: { shape: ReactNode }) {
  return (
    <span className="card-icon">
      <svg
        viewBox="0 0 24 24"
        width={17}
        height={17}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {shape}
      </svg>
    </span>
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!can(session, "dashboard.view")) return <Forbidden />;
  const stats = dashboardPayload(getDb());
  const entra = stats.directory.entra.connected
    ? stats.directory.entra.tenantName || "Connected"
    : "Not connected";
  const ad = stats.directory.ad.configured ? stats.directory.ad.host : "Not configured";

  return (
    <>
      <div className="top">
        <div>
          <h1>Dashboard</h1>
          <p className="lede">
            Approvals, denials, and pending elevations across enrolled devices. High-risk items need a closer look
            before you grant local admin.
          </p>
        </div>
        {can(session, "requests.view") ? (
          <Link className="primary" href="/elevations" prefetch>
            Review requests
          </Link>
        ) : null}
      </div>

      <div className="grid cards four dash-section">
        <Link className="card" href="/elevations" prefetch>
          <div className="card-head">
            <StatIcon shape={ICONS.inbox} />
            <div className="k">Pending</div>
          </div>
          <div className="v">{stats.pending}</div>
        </Link>
        <div className="card">
          <div className="card-head">
            <StatIcon shape={ICONS.checkCircle} />
            <div className="k">Approved</div>
          </div>
          <div className="v">{stats.approved}</div>
        </div>
        <div className="card">
          <div className="card-head">
            <StatIcon shape={ICONS.xCircle} />
            <div className="k">Denied</div>
          </div>
          <div className="v">{stats.denied}</div>
        </div>
        <Link className="card accent" href="/elevations" prefetch>
          <div className="card-head">
            <StatIcon shape={ICONS.alertTriangle} />
            <div className="k">High / critical pending</div>
          </div>
          <div className="v">{stats.highRiskPending}</div>
        </Link>
      </div>

      <div className="grid cards four dash-section">
        <Link className="card" href="/directory" prefetch>
          <div className="card-head">
            <StatIcon shape={ICONS.clock} />
            <div className="k">Active JIT windows</div>
          </div>
          <div className="v">{stats.activeJit}</div>
        </Link>
        <Link className="card" href="/devices" prefetch>
          <div className="card-head">
            <StatIcon shape={ICONS.monitor} />
            <div className="k">Enrolled devices</div>
          </div>
          <div className="v">{stats.devices}</div>
        </Link>
        <Link className="card" href="/allowlists" prefetch>
          <div className="card-head">
            <StatIcon shape={ICONS.shield} />
            <div className="k">Always-allow rules</div>
          </div>
          <div className="v">{stats.policies}</div>
        </Link>
        <Link
          className={`card ${stats.failedUpdates > 0 ? "danger" : ""}`}
          href="/devices"
          prefetch
        >
          <div className="card-head">
            <StatIcon shape={ICONS.alertTriangle} />
            <div className="k">Failed agent updates</div>
          </div>
          <div className="v">{stats.failedUpdates}</div>
        </Link>
      </div>

      <div className="grid cards dash-section">
        <div className="card">
          <div className="card-head">
            <StatIcon shape={ICONS.calendar} />
            <div className="k">Last 7 days</div>
          </div>
          <p className="card-note">
            {stats.last7Days.pending} pending · {stats.last7Days.approved} approved · {stats.last7Days.denied} denied
            <br />
            {stats.auditToday} audit events in the last day
          </p>
        </div>
        <div className="card">
          <div className="card-head">
            <StatIcon shape={ICONS.timer} />
            <div className="k">Median time to decision</div>
          </div>
          <div className="v sm">
            {stats.medianMinutesToDecision == null ? "—" : `${stats.medianMinutesToDecision} min`}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <StatIcon shape={ICONS.network} />
            <div className="k">Directory</div>
          </div>
          <p className="card-note">
            Entra: {entra}
            <br />
            AD: {ad}
          </p>
          <Link href="/configuration/integrations" prefetch className="mono dash-link">
            Open Identity Sources →
          </Link>
        </div>
      </div>

      <div className="device-layout dash-section">
        <div>
          <h2 className="section-title">Pending by risk</h2>
          <div className="panel">
            <table>
              <tbody>
                {["critical", "high", "medium", "low"].map((level) => (
                  <tr key={level}>
                    <td><span className={`pill risk-${level}`}>{level}</span></td>
                    <td className="num">{stats.riskPending[level] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="section-title gap-top">Most requested programs</h2>
          <div className="panel">
            <table>
              <tbody>
                {stats.topPrograms.length ? (
                  stats.topPrograms.map((row) => (
                    <tr key={row.filePath}>
                      <td>
                        <div className="mono">{displayPath(row.filePath)}</div>
                      </td>
                      <td className="num">{row.count}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty">No requests yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="section-title">Recent elevation activity</h2>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Who / what</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.length ? (
                  stats.recent.map((row) => (
                    <tr key={row.id}>
                      <td><span className={`pill ${row.status}`}>{row.status}</span></td>
                      <td><span className={`pill risk-${row.riskLevel}`}>{row.riskLevel}</span></td>
                      <td>
                        <div>{displayPath(row.filePath)}</div>
                        <div className="mono">{row.userName} · {row.hostname}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="empty">No elevation activity yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
