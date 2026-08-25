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
  }
}
