import { NextResponse } from "next/server";
import { getDb, listAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: Request) {
  const auth = await requireAdmin("audit.view");
  if (isResponse(auth)) return auth;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || undefined;
  const action = url.searchParams.get("action") || undefined;
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const db = getDb();
  const events = listAudit(db, { q, action, from, to, limit: 10_000 });
  const lines = ["at,actor,action,target,details"];
  for (const e of events) {
    lines.push(
      [e.at, csvEscape(e.actor), csvEscape(e.action), csvEscape(e.target), csvEscape(e.details)].join(","),
    );
  }
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit-export.csv"',
    },
  });
}
