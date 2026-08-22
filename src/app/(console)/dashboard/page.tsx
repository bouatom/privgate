import Link from "next/link";
import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { displayPath } from "@/lib/format";
import { dashboardPayload } from "@/lib/metrics";
import { Forbidden } from "../forbidden";

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
          <Link className="primary" href="/requests" prefetch style={{ padding: "8px 12px", background: "var(--amber)", color: "var(--primary-ink)", display: "inline-block" }}>
            Review requests
          </Link>
        ) : null}
      </div>

      <div className="grid cards four" style={{ marginBottom: 16 }}>
        <Link className="card" href="/requests" prefetch>
          <div className="k">Pending</div>
          <div className="v">{stats.pending}</div>
        </Link>
        <div className="card">
          <div className="k">Approved</div>
          <div className="v">{stats.approved}</div>
        </div>
        <div className="card">
          <div className="k">Denied</div>
          <div className="v">{stats.denied}</div>
        </div>
        <Link className="card" href="/requests" prefetch>
          <div className="k">High / critical pending</div>
          <div className="v">{stats.highRiskPending}</div>
        </Link>
      </div>

      <div className="grid cards" style={{ marginBottom: 20 }}>
        <Link className="card" href="/jit" prefetch>
          <div className="k">Active JIT windows</div>
          <div className="v">{stats.activeJit}</div>
        </Link>
        <Link className="card" href="/devices" prefetch>
          <div className="k">Enrolled devices</div>
          <div className="v">{stats.devices}</div>
        </Link>
        <Link className="card" href="/allowlists" prefetch>
          <div className="k">Always-allow policies</div>
          <div className="v">{stats.policies}</div>
        </Link>
      </div>

      <div className="grid cards" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="k">Last 7 days</div>
          <p className="lede" style={{ marginTop: 12, fontSize: 14 }}>
            {stats.last7Days.pending} pending · {stats.last7Days.approved} approved · {stats.last7Days.denied} denied
            <br />
            {stats.auditToday} audit events in the last day
          </p>
        </div>
        <div className="card">
          <div className="k">Median time to decision</div>
          <div className="v" style={{ fontSize: 22 }}>
            {stats.medianMinutesToDecision == null ? "—" : `${stats.medianMinutesToDecision} min`}
          </div>
        </div>
        <div className="card">
          <div className="k">Directory</div>
          <p className="lede" style={{ marginTop: 12, fontSize: 14 }}>
            Entra: {entra}
            <br />
            AD: {ad}
          </p>
          <Link href="/configuration/integrations" prefetch className="mono" style={{ display: "inline-block", marginTop: 8 }}>
            Open integrations →
          </Link>
        </div>
      </div>

      <div className="device-layout" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="section-title">Pending by risk</h2>
          <div className="panel">
            <table>
              <tbody>
                {["critical", "high", "medium", "low"].map((level) => (
                  <tr key={level}>
                    <td><span className={`pill risk-${level}`}>{level}</span></td>
                    <td>{stats.riskPending[level] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="section-title" style={{ marginTop: 16 }}>Most requested programs</h2>
          <div className="panel">
            <table>
              <tbody>
                {stats.topPrograms.length ? (
                  stats.topPrograms.map((row) => (
                    <tr key={row.filePath}>
                      <td>
                        <div className="mono">{displayPath(row.filePath)}</div>
                      </td>
                      <td>{row.count}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="lede" style={{ padding: 18 }}>No requests yet.</td>
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
                    <td colSpan={3} className="lede" style={{ padding: 18 }}>No elevation activity yet.</td>
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
