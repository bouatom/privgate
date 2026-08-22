import { assertProductionSecrets } from "./lib/secrets";

export function register() {
  // `next build` also loads instrumentation with NODE_ENV=production; only the
  // running server should refuse to start over missing secrets.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  assertProductionSecrets();
}
