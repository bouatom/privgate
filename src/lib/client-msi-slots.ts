/** Keep in sync with packaging/windows/build-client-msi.cjs */
export const API_BASE_SLOT = "http://privgate-api-base.invalid/".padEnd(256, "A");
export const TOKEN_SLOT = "privgate-enrollment-token.".padEnd(128, "T");

export function fitSlot(slot: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > slot.length) {
    throw new Error(`Value exceeds MSI slot (${trimmed.length} > ${slot.length})`);
  }
  return trimmed.padEnd(slot.length, " ");
}

export function patchMsiSlots(msi: Buffer, apiBase: string, token: string): Buffer {
  const out = Buffer.from(msi);
  replaceSlot(out, API_BASE_SLOT, fitSlot(API_BASE_SLOT, apiBase));
  replaceSlot(out, TOKEN_SLOT, fitSlot(TOKEN_SLOT, token));
  return out;
}

function replaceSlot(buf: Buffer, slot: string, padded: string) {
  for (const enc of ["utf16le", "utf8"] as const) {
    const needle = Buffer.from(slot, enc);
    const repl = Buffer.from(padded, enc);
    if (needle.length !== repl.length) {
      throw new Error(`MSI slot encoding length mismatch (${enc})`);
    }
    let idx = buf.indexOf(needle);
    let n = 0;
    while (idx !== -1) {
      repl.copy(buf, idx);
      n += 1;
      idx = buf.indexOf(needle, idx + needle.length);
    }
    if (n > 0) return;
  }
  throw new Error("Could not brand the packaged Windows client MSI with this console URL");
}
