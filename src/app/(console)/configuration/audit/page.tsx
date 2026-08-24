import Link from "next/link";
import { can, getSession } from "@/lib/auth";
import { getDb, getDevice, listAudit, listAuditActions } from "@/lib/db";
import { formatDetails, formatWhen } from "@/lib/format";
import { Forbidden } from "../../forbidden";
import { presentAudit } from "@/lib/present";

const PAGE_SIZE = 50;

type AuditSearchParams = {
  q?: string;
  from?: string;
  to?: string;
  action?: string;
  offset?: string;
};

/** Date-only input values need explicit UTC bounds so the whole day matches ISO `at` strings. */
function dayBound(value: string | undefined, edge: "start" | "end"): string | undefined {
  if (!value) return undefined;
  if (value.length > 10) return value;
  return edge === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

function deviceActorResolver(db: ReturnType<typeof getDb>) {
  return (actor: string): string | null => {
    if (!actor.startsWith("device:")) return null;
    return getDevice(db, actor.slice("device:".length))?.hostname ?? null;
  };
}

function pagerHref(params: AuditSearchParams, offset: number): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.action) qs.set("action", params.action);
  if (offset > 0) qs.set("offset", String(offset));
  const query = qs.toString();
  return `/configuration/audit${query ? `?${query}` : ""}`;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const session = await getSession();
  if (!can(session, "audit.view")) return <Forbidden />;
  const params = await searchParams;
  const offset = Math.max(0, Number.parseInt(params.offset || "0", 10) || 0);
  const db = getDb();

  // Fetch one extra row to know whether an older page exists.
  const found = listAudit(db, {
    q: params.q || undefined,
    action: params.action || undefined,
    from: dayBound(params.from, "start"),
    to: dayBound(params.to, "end"),
    limit: PAGE_SIZE + 1,
    offset,
  });
  const hasOlder = found.length > PAGE_SIZE;
  const rows = presentAudit(found.slice(0, PAGE_SIZE), deviceActorResolver(db));
  const actions = listAuditActions(db);
  const filtered = Boolean(params.q || params.from || params.to || params.action);

  return (
    <>
      <div className="top">
        <div>
          <h1>Audit</h1>
          <p className="lede">Append-only. There is no API to edit or delete events.</p>
        </div>
      </div>
      <form action="/configuration/audit" method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="q" defaultValue={params.q || ""} placeholder="Search actor, action, hash…" />
        <label style={{ alignSelf: "center" }} className="lede">From</label>
        <input type="date" name="from" defaultValue={params.from || ""} />
        <label style={{ alignSelf: "center" }} className="lede">To</label>
        <input type="date" name="to" defaultValue={params.to || ""} />
        <select name="action" defaultValue={params.action || ""} aria-label="Filter by action">
          <option value="">All actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <button className="primary" type="submit">Search</button>
      </form>
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
                  {filtered ? "No events match those filters." : "No audit events yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {offset > 0 || hasOlder ? (
        <div className="row-actions" style={{ marginTop: 12 }}>
          {offset > 0 ? (
            <Link className="ghost" href={pagerHref(params, Math.max(0, offset - PAGE_SIZE))}>
              ← Newer
            </Link>
          ) : null}
          {hasOlder ? (
            <Link className="ghost" href={pagerHref(params, offset + PAGE_SIZE)}>
              Older →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
