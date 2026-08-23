/** Decode a Windows SID from AD `objectSid` (binary). */
export function sidFromBinary(value: unknown): string {
  const buf = toBuffer(value);
  if (!buf || buf.length < 8) return "";
  const revision = buf[0];
  const count = buf[1];
  if (buf.length < 8 + count * 4) return "";
  const authority = readUIntBE(buf, 2, 6);
  const parts = [`S-${revision}-${authority}`];
  for (let i = 0; i < count; i++) {
    parts.push(String(readUInt32LE(buf, 8 + i * 4)));
  }
  return parts.join("-");
}

export function dnsDomainFromBaseDn(baseDn: string): string {
  return baseDn
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^DC=/i.test(part))
    .map((part) => part.slice(part.indexOf("=") + 1))
    .filter(Boolean)
    .join(".");
}

export function ldapScalar(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return ldapScalar(value[0]);
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isBytes(value)) return Buffer.from(value).toString("utf8");
  return "";
}

export type AdDirectoryUser = {
  displayName: string;
  userPrincipalName: string;
  adSid: string;
};

export function usersFromLdapEntries(
  entries: Array<Record<string, unknown>>,
  baseDn: string,
): AdDirectoryUser[] {
  const dns = dnsDomainFromBaseDn(baseDn);
  const out: AdDirectoryUser[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const sam = ldapScalar(entry.sAMAccountName);
    const upn = ldapScalar(entry.userPrincipalName) || (sam && dns ? `${sam}@${dns}` : "");
    if (!upn) continue;
    const key = upn.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const displayName = ldapScalar(entry.displayName) || ldapScalar(entry.cn) || sam || upn;
    out.push({
      displayName,
      userPrincipalName: upn,
      adSid: sidFromBinary(entry.objectSid),
    });
  }
  return out;
}

function toBuffer(value: unknown): Buffer | null {
  if (value == null) return null;
  if (Array.isArray(value)) return toBuffer(value[0]);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (/^S-1-/i.test(value)) return null;
    try {
      const buf = Buffer.from(value, "base64");
      return buf.length >= 8 ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Buffer.isBuffer(value);
}

function readUIntBE(buf: Buffer, offset: number, length: number): number {
  let n = 0;
  for (let i = 0; i < length; i++) n = n * 256 + buf[offset + i];
  return n;
}

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}
