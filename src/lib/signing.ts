import { createHmac, timingSafeEqual } from "node:crypto";

export type TicketType = "elevate" | "jit";

export type ElevationTicket = {
  typ: TicketType;
  sub: string;
  dev: string;
  sha256: string;
  publisher: string;
  path: string;
  child: "deny" | "allow";
  nbf: number;
  exp: number;
  nonce: string;
};

function canonical(ticket: ElevationTicket): string {
  const keys = Object.keys(ticket).sort() as (keyof ElevationTicket)[];
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = ticket[key];
  return JSON.stringify(ordered);
}

export function signTicket(ticket: ElevationTicket, key: string): string {
  const payload = Buffer.from(canonical(ticket), "utf8").toString("base64url");
  const mac = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyTicket(
  packed: string,
  key: string,
  now = Math.floor(Date.now() / 1000),
): ElevationTicket {
  const parts = packed.split(".");
  if (parts.length !== 2) throw new Error("malformed ticket");
  const [payload, mac] = parts;
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("bad ticket signature");
  }
  const ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ElevationTicket;
  if (ticket.nbf > now + 30) throw new Error("ticket not yet valid");
  if (ticket.exp <= now) throw new Error("ticket expired");
  return ticket;
}

export function hmacDevice(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  bodySha256: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${bodySha256}`)
    .digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
