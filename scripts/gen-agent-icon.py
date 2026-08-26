#!/usr/bin/env python3
"""Regenerate agent/AppIcon.ico from the src/app/icon.svg geometry.

Pure standard library (struct + zlib): PNGs are encoded by hand and packed
into a Vista+ PNG-compressed ICO container. Geometry mirrors the SVG exactly:
navy #101218 rounded tile (rx 14), amber #E0A14A shield (two cubic beziers),
navy keyhole cutout. Anti-aliasing via 4x supersampling with premultiplied
box filtering.

Usage: python3 scripts/gen-agent-icon.py   (writes agent/AppIcon.ico)
"""
import os
import struct
import zlib

NAVY = (0x10, 0x12, 0x18)
AMBER = (0xE0, 0xA1, 0x4A)
SIZES = [16, 24, 32, 48, 64, 256]
SS = 4  # supersampling factor per axis


def bezier(p0, p1, p2, p3, t):
    mt = 1.0 - t
    return (
        mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0],
        mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1],
    )


def shield_outline():
    """icon.svg shield path, flattened: M32 9 L51 16.2 V30 C.. Z."""
    pts = [(32.0, 9.0), (51.0, 16.2), (51.0, 30.0)]
    steps = 24
    for i in range(1, steps + 1):
        pts.append(bezier((51, 30), (51, 42.6), (42.7, 50), (32, 54.5), i / steps))
    for i in range(1, steps + 1):
        pts.append(bezier((32, 54.5), (21.3, 50), (13, 42.6), (13, 30), i / steps))
    pts.append((13.0, 16.2))  # closing edge back to (32,9) is implicit
    return pts


OUTLINE = shield_outline()


def point_in_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            cross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < cross:
                inside = not inside
        j = i
    return inside


def tile_inside(x, y):
    """Rounded square 64x64, rx 14 (corner circles centered at r,r from edges)."""
    r = 14.0
    if x < 0 or y < 0 or x > 64 or y > 64:
        return False
    cxr = 64.0 - r
    if x < r and y < r:
        return (x - r) ** 2 + (y - r) ** 2 <= r * r
    if x > cxr and y < r:
        return (x - cxr) ** 2 + (y - r) ** 2 <= r * r
    if x < r and y > cxr:
        return (x - r) ** 2 + (y - cxr) ** 2 <= r * r
    if x > cxr and y > cxr:
        return (x - cxr) ** 2 + (y - cxr) ** 2 <= r * r
    return True


def keyhole_inside(x, y):
    """Navy cutouts: circle + stem (rect w/ r2.2 bottom cap) + notch bar."""
    if (x - 32) ** 2 + (y - 26.5) ** 2 <= 5.5**2:
        return True
    if 29.8 <= x <= 34.2 and 30.0 <= y <= 43.5:
        return True
    if y >= 43.5 and (x - 32) ** 2 + (y - 43.5) ** 2 <= 2.2**2:
        return True
    if 33.6 <= x <= 40.6 and 37.5 <= y <= 41.1:
        return True
    if x >= 40.6 and (x - 40.6) ** 2 + (y - 39.3) ** 2 <= 1.8**2:
        return True
    return False


def sample(u, v):
    if not tile_inside(u, v):
        return None
    color = NAVY
    if point_in_polygon(u, v, OUTLINE):
        color = AMBER
        if keyhole_inside(u, v):
            color = NAVY
    return color


def render(size):
    n = size * SS
    total = float(SS * SS)
    acc = [[0.0, 0.0, 0.0, 0.0] for _ in range(size * size)]
    for py in range(n):
        v = (py + 0.5) / n * 64.0
        row = py // SS * size
        for px_ in range(n):
            u = (px_ + 0.5) / n * 64.0
            c = sample(u, v)
            if c is None:
                continue
            a = acc[row + px_ // SS]
            a[0] += c[0]
            a[1] += c[1]
            a[2] += c[2]
            a[3] += 1.0
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r_, g_, b_, a_ = acc[y * size + x]
            if a_ == 0.0:
                row += b"\x00\x00\x00\x00"
            else:
                cov = a_ / total
                row += bytes(
                    (
                        min(255, int(round(r_ / a_))),
                        min(255, int(round(g_ / a_))),
                        min(255, int(round(b_ / a_))),
                        min(255, int(round(cov * 255))),
                    )
                )
        rows.append(bytes(row))
    return rows


def check(rows, size):
    def px(x, y):
        i = x * 4
        return tuple(rows[y][i : i + 4])

    near = lambda a, b: all(abs(p - q) <= 14 for p, q in zip(a[:3], b))
    # True corners fall outside the rx-14 rounding at every size.
    assert px(0, 0)[3] == 0, "tile corner must be transparent"
    assert px(size - 1, size - 1)[3] == 0, "tile corner must be transparent"
    half = 32.0 / size  # worst-case pixel-center offset in SVG units
    assert near(px(size // 2, int(17 * size / 64)), AMBER), "shield body"
    assert near(px(size // 2, int(26.5 * size / 64)), NAVY), "keyhole circle"
    assert near(px(size // 2, int(48 * size / 64)), AMBER), "shield skirt"
    print(f"  {size}px OK")


def encode_png(size, rows):
    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + r for r in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(here, "..", "agent", "AppIcon.ico")
    entries = []
    for size in SIZES:
        rows = render(size)
        check(rows, size)
        entries.append((size, encode_png(size, rows)))
    out = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    body = b""
    for size, data in entries:
        # width/height byte: 256 wraps to 0 per the ICONDIR spec.
        out += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        body += data
        offset += len(data)
    with open(out_path, "wb") as fh:
        fh.write(out + body)
    print(f"wrote {os.path.normpath(out_path)} ({len(out) + len(body)} bytes, {SIZES})")


if __name__ == "__main__":
    main()
