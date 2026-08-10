#!/usr/bin/env python3
"""
Generate the app icon and the splash glyph.

Regenerate rather than hand-editing `assets/*.png`. Synthesised means there is
no licence attached to the artwork and nothing to declare at App Review — the
same reasoning the timer project applies to its alert sounds.

The drawing is the app's own timeline, reduced to its two marks: a **route** in
`colors.move` between **place dots** in `colors.stay`. Anything more literal — a
map, a pin, a satellite — would either need artwork this cannot produce or imply
a feature the app does not have (it draws no maps and asks no geocoder).

No Pillow, no cairo, no ImageMagick: none are installed and none are worth a
build dependency for two files that change once a year. PNG is written by hand
(zlib + CRC32) and shapes are rasterised from signed distance fields, which
gives proper antialiasing from a single sample per pixel and costs nothing.
"""

import struct
import zlib

SIZE = 1024

# Straight from src/theme/tokens.ts. If those change, these should too.
BG_TOP = (0x14, 0x1C, 0x26)
BG_BOTTOM = (0x0B, 0x0F, 0x14)
ROUTE = (0x38, 0xBD, 0xF8)  # colors.move
PLACE = (0xA7, 0x8B, 0xFA)  # colors.stay

# The journey, in unit coordinates with y running down the image. Bottom left to
# top right, wandering — a day, not a straight line.
WAYPOINTS = [
    (0.205, 0.800),
    (0.360, 0.585),
    (0.505, 0.690),
    (0.650, 0.435),
    (0.800, 0.225),
]

STROKE = 64.0  # route width in px at 1024
DOT_OUTER = 60.0
DOT_INNER = 27.0


def catmull_rom(points, samples_per_span=48):
    """A smooth polyline through every waypoint, so the route reads as a path
    rather than as a chain of straight legs."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for s in range(samples_per_span + 1):
            t = s / samples_per_span
            t2, t3 = t * t, t * t * t
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            if not out or (x, y) != out[-1]:
                out.append((x, y))
    return out


def blend(dst, idx, colour, alpha):
    if alpha <= 0:
        return
    if alpha > 1:
        alpha = 1.0
    for c in range(3):
        dst[idx + c] = int(dst[idx + c] * (1 - alpha) + colour[c] * alpha + 0.5)


def draw_capsule(buf, stride, a, b, half, colour, has_alpha):
    """One segment of the route, antialiased from its distance field."""
    ax, ay = a
    bx, by = b
    lo_x = max(0, int(min(ax, bx) - half - 2))
    hi_x = min(SIZE - 1, int(max(ax, bx) + half + 2))
    lo_y = max(0, int(min(ay, by) - half - 2))
    hi_y = min(SIZE - 1, int(max(ay, by) + half + 2))

    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    channels = 4 if has_alpha else 3

    for y in range(lo_y, hi_y + 1):
        row = y * stride
        py = y + 0.5
        for x in range(lo_x, hi_x + 1):
            px = x + 0.5
            if length_sq == 0:
                t = 0.0
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / length_sq
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            qx, qy = ax + t * dx, ay + t * dy
            d = ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5 - half
            # One pixel of feathering either side of the edge.
            cov = 0.5 - d
            if cov <= 0:
                continue
            idx = row + x * channels
            blend(buf, idx, colour, cov)
            if has_alpha:
                existing = buf[idx + 3]
                new = int(255 * (1 if cov > 1 else cov))
                buf[idx + 3] = max(existing, new)


def draw_disc(buf, stride, centre, radius, colour, has_alpha, alpha_out=True):
    cx, cy = centre
    lo_x = max(0, int(cx - radius - 2))
    hi_x = min(SIZE - 1, int(cx + radius + 2))
    lo_y = max(0, int(cy - radius - 2))
    hi_y = min(SIZE - 1, int(cy + radius + 2))
    channels = 4 if has_alpha else 3

    for y in range(lo_y, hi_y + 1):
        row = y * stride
        py = y + 0.5
        for x in range(lo_x, hi_x + 1):
            px = x + 0.5
            d = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 - radius
            cov = 0.5 - d
            if cov <= 0:
                continue
            idx = row + x * channels
            blend(buf, idx, colour, cov)
            if has_alpha:
                new = int(255 * (1 if cov > 1 else cov))
                if alpha_out:
                    buf[idx + 3] = max(buf[idx + 3], new)
                else:
                    # Punching the hole in a donut: this pixel becomes transparent.
                    buf[idx + 3] = int(buf[idx + 3] * (1 - (1 if cov > 1 else cov)))


def render(has_alpha):
    channels = 4 if has_alpha else 3
    stride = SIZE * channels
    buf = bytearray(SIZE * stride)

    if has_alpha:
        # Transparent: the splash screen supplies its own background colour, and
        # a glyph that carries its own would show as a square on top of it.
        scale = 0.76
    else:
        scale = 1.0
        for y in range(SIZE):
            t = y / (SIZE - 1)
            r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
            g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
            b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
            row = y * stride
            for x in range(SIZE):
                idx = row + x * 3
                buf[idx] = r
                buf[idx + 1] = g
                buf[idx + 2] = b

    def place(p):
        # Scale about the centre, so the splash glyph keeps its composition.
        return (
            (p[0] - 0.5) * scale * SIZE + SIZE / 2,
            (p[1] - 0.5) * scale * SIZE + SIZE / 2,
        )

    path = [place(p) for p in catmull_rom(WAYPOINTS)]
    half = STROKE * scale / 2

    for i in range(len(path) - 1):
        draw_capsule(buf, stride, path[i], path[i + 1], half, ROUTE, has_alpha)

    # A place dot at each end — the two marks the timeline actually uses.
    for end in (WAYPOINTS[0], WAYPOINTS[-1]):
        centre = place(end)
        draw_disc(buf, stride, centre, DOT_OUTER * scale, PLACE, has_alpha)
        if has_alpha:
            draw_disc(buf, stride, centre, DOT_INNER * scale, PLACE, has_alpha, alpha_out=False)
        else:
            # Punch the donut with the background colour under it.
            t = centre[1] / (SIZE - 1)
            hole = tuple(int(BG_TOP[c] + (BG_BOTTOM[c] - BG_TOP[c]) * t) for c in range(3))
            draw_disc(buf, stride, centre, DOT_INNER * scale, hole, has_alpha)

    return bytes(buf), channels


def write_png(path, pixels, channels):
    colour_type = 6 if channels == 4 else 2
    raw = bytearray()
    stride = SIZE * channels
    for y in range(SIZE):
        raw.append(0)  # filter: none
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, colour_type, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(png)


if __name__ == "__main__":
    # The icon is opaque RGB. App Store Connect rejects an alpha channel on the
    # marketing icon, and iOS masks the corners itself — so a full-bleed square
    # is what to supply.
    icon, ch = render(has_alpha=False)
    write_png("assets/icon.png", icon, ch)
    print("wrote assets/icon.png (1024x1024, RGB, no alpha)")

    splash, ch = render(has_alpha=True)
    write_png("assets/splash-icon.png", splash, ch)
    print("wrote assets/splash-icon.png (1024x1024, RGBA)")
