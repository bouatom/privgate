import { assertProductionSecrets } from "./lib/secrets";

export async function register() {
  // `next build` also loads instrumentation with NODE_ENV=production; only the
  // running server should refuse to start over missing secrets.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  assertProductionSecrets();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { attachAgentWebSocket } = await import("./lib/realtime/agent-hub");
    attachAgentWebSocket();
    // Periodic self-update sweep (6h + delayed boot tick). Injectable and
    // env-disabled for tests; registers its own shutdown hook.
    const { startUpdateSweep } = await import("./lib/self-update-service");
    startUpdateSweep();
    // Periodic agent update sweep (device update-policy push). Injectable and
    // env-disabled for tests; registers its own shutdown hook.
    const { startAgentUpdateSweep } = await import("./lib/agent-update-sweep");
    startAgentUpdateSweep();
    // Periodic audit retention sweep. Injectable and env-disabled for tests;
    // default-safe: no-op unless a positive retention is configured.
    const { startAuditRetentionSweep } = await import("./lib/audit-retention-sweep");
    startAuditRetentionSweep();
  }
}
