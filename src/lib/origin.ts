export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function setupRedirectUris(origin: string): string[] {
  const uris = [
    `${origin}/api/setup/entra/callback`,
    `${origin}/api/auth/entra/callback`,
  ];
  if (origin !== "http://localhost:3000") {
    uris.push("http://localhost:3000/api/setup/entra/callback");
    uris.push("http://localhost:3000/api/auth/entra/callback");
  }
  return [...new Set(uris)];
}
