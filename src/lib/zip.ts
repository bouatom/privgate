import "server-only";
import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer | string };

function u16(value: number) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function u32(value: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0);
  return buf;
}

/** Unencrypted ZIP (deflate) with UTF-8 names. No extra dependencies. */
export function zipBuffers(entries: ZipEntry[]): Buffer {
    const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const CENTRAL = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const flags = 0x0800;
    const method = 8;
    const local = Buffer.concat([
      LOCAL,
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      CENTRAL,
      u16(20),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    EOCD,
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}
