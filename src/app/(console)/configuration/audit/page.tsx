import { getDb, listAudit } from "@/lib/db";
import { presentAudit } from "@/lib/present";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
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
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.at}</td>
                <td className="mono">{row.actor}</td>
                <td>{row.action}</td>
                <td>
                  <div className="mono">{row.target}</div>
                  <div className="mono">{JSON.stringify(row.details)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
