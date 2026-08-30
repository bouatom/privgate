import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { PENDING_STALE_MS } from "./agent-update";
import { getAdSettings, listAudit, listDeviceSummaries, listJit, listPolicies, listRequests, listUsers } from "./db";
import { publicDirectoryStatus } from "./entra";

export type DashboardStats = {
  pending: number;
  approved: number;
  denied: number;
  highRiskPending: number;
  activeJit: number;
  devices: number;
  policies: number;
  users: number;
  medianMinutesToDecision: number | null;
  last7Days: { pending: number; approved: number; denied: number };
  riskPending: Record<string, number>;
  topPrograms: Array<{ filePath: string; count: number }>;
  recent: Array<{
    id: string;
    status: string;
    filePath: string;
    userName: string;
    hostname: string;
    requestedAt: string;
    riskLevel: string;
  }>;
  auditToday: number;
  /** PCs whose last agent update did not confirm: "+stale" marker, or "+pending" older than the server's stale window. */
  failedUpdates: number;
};

function countByStatus(rows: Array<{ status: string }>, status: string) {
  return rows.filter((r) => r.status === status).length;
}

function inLastDays(iso: string, days: number) {
  return new Date(iso).getTime() >= Date.now() - days * 24 * 3600_000;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

export function dashboardStats(db: DatabaseSync): DashboardStats {
  const requests = listRequests(db);
  const pending = countByStatus(requests, "pending");
  const approved = countByStatus(requests, "approved");
  const denied = countByStatus(requests, "denied");
  const highRiskPending = requests.filter(
    (r) => r.status === "pending" && (r.riskLevel === "high" || r.riskLevel === "critical"),
  ).length;
  const last7 = requests.filter((r) => inLastDays(r.requestedAt, 7));
  const decisionMinutes = requests
    .filter((r) => r.decidedAt)
    .map((r) => (new Date(r.decidedAt!).getTime() - new Date(r.requestedAt).getTime()) / 60000)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const riskPending: Record<string, number> = {};
  for (const row of requests.filter((r) => r.status === "pending")) {
    riskPending[row.riskLevel] = (riskPending[row.riskLevel] || 0) + 1;
  }
  const programCounts = new Map<string, number>();
  for (const row of requests) {
    programCounts.set(row.filePath, (programCounts.get(row.filePath) || 0) + 1);
  }
  const topPrograms = [...programCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([filePath, count]) => ({ filePath, count }));

  return {
    pending,
    approved,
    denied,
    highRiskPending,
    activeJit: listJit(db).filter((g) => g.status === "active").length,
    devices: listDeviceSummaries(db).length,
    policies: listPolicies(db).length,
    users: listUsers(db).length,
    medianMinutesToDecision: median(decisionMinutes),
    last7Days: {
      pending: countByStatus(last7, "pending"),
      approved: countByStatus(last7, "approved"),
      denied: countByStatus(last7, "denied"),
    },
    riskPending,
    topPrograms,
    recent: requests.slice(0, 8).map((r) => ({
      id: r.id,
      status: r.status,
      filePath: r.filePath,
      userName: r.userName,
      hostname: r.hostname,
      requestedAt: r.requestedAt,
      riskLevel: r.riskLevel,
    })),
    auditToday: listAudit(db).filter((e) => inLastDays(e.at, 1)).length,
    failedUpdates: listDeviceSummaries(db).filter((d) => {
      if (!d.agentVersion) return false;
      if (d.agentVersion.includes("+stale")) return true;
      const pending = d.agentVersion.match(/\+pending@(\d+)/);
      return Boolean(pending && Date.now() - Number(pending[1]) > PENDING_STALE_MS);
    }).length,
  };
}

export function dashboardPayload(db: DatabaseSync) {
  const ad = getAdSettings(db);
  return {
    ...dashboardStats(db),
    directory: {
      entra: publicDirectoryStatus(db),
      ad: { configured: ad.configured, host: ad.host, lastTestedAt: ad.lastTestedAt },
    },
  };
}
