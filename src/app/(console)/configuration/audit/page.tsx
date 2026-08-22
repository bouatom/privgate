import { can, getSession } from "@/lib/auth";
import { getDb, listAudit } from "@/lib/db";
import { formatDetails, formatWhen } from "@/lib/format";
import { Forbidden } from "../../forbidden";
import { presentAudit } from "@/lib/present";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "audit.view")) return <Forbidden />;
  const { q = "" } = await searchParams;
  const rows = presentAudit(listAudit(getDb(), q || undefined));

  return (
    <>
      <div className="top">
        <div>
          <h1>Audit</h1>
          <p className="lede">Append-only. There is no API to edit or delete events.</p>
        </div>
        <form action="/configuration/audit" method="get" style={{ display: "flex", gap: 8 }}>
          <input name="q" defaultValue={q} placeholder="Search actor, action, hash…" />
          <button className="primary" type="submit">Search</button>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{formatWhen(row.at)}</td>
                  <td className="mono">{row.actor}</td>
                  <td>{row.action}</td>
                  <td>
                    <div className="mono">{row.target}</div>
                    {formatDetails(row.details) ? <div className="mono">{formatDetails(row.details)}</div> : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="lede" style={{ padding: 18 }}>
                  {q ? "No events match that search." : "No audit events yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
