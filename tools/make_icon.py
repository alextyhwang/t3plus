"""Draws the t3+ icon: a pixel-art plus with a dithered glow, on a 16x16 grid.

One grid makes every file, so the SVG and the PNGs match pixel for pixel:
  icons/icon.svg                  source (crisp at any size)
  icons/icon-{16,32,48,128}.png   for the manifest (each grid cell = size/16 px)

Run: python tools/make_icon.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

GRID = 16
BG = (13, 15, 26)  # near-black navy, like T3's dark theme
# Plus tones, light at the top-left to deep at the bottom-right (the glow palette).
TONES = [(186, 196, 255), (138, 152, 255), (99, 114, 255), (72, 86, 232)]
GLOW = [(36, 44, 110), (52, 62, 150)]  # dithered halo, faint to brighter
BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def in_plus(x, y):
    return (6 <= x <= 9 and 2 <= y <= 13) or (2 <= x <= 13 and 6 <= y <= 9)


def cells():
    """{(x, y): rgb} for every lit cell."""
    out = {}
    for y in range(GRID):
        for x in range(GRID):
            t = (BAYER4[y % 4][x % 4] + 0.5) / 16
            if in_plus(x, y):
                # Diagonal ramp across the plus, dithered between neighbouring tones.
                v = ((x - 2) + (y - 2)) / 22 * (len(TONES) - 1)
                lo = int(v)
                out[(x, y)] = TONES[min(len(TONES) - 1, lo + (1 if v - lo > t else 0))]
                continue
            # Halo: distance (in cells) to the plus, lit by an ordered dither.
            d = min(
                max(abs(x - min(max(x, 6), 9)), abs(y - min(max(y, 2), 13))),
                max(abs(x - min(max(x, 2), 13)), abs(y - min(max(y, 6), 9))),
            )
            if d == 1 and t < 0.55:
                out[(x, y)] = GLOW[1]
            elif d == 2 and t < 0.22:
                out[(x, y)] = GLOW[0]
    return out


def hexrgb(c):
    return "#%02x%02x%02x" % c


def svg(lit):
    rects = "".join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{hexrgb(c)}"/>' for (x, y), c in sorted(lit.items()))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="128" height="128" shape-rendering="crispEdges">'
        '<title>t3+</title>'
        '<defs><clipPath id="r"><rect width="16" height="16" rx="3.5"/></clipPath></defs>'
        f'<g clip-path="url(#r)"><rect width="16" height="16" fill="{hexrgb(BG)}"/>{rects}</g>'
        "</svg>\n"
    )


def png(lit, size):
    cell = size // GRID
    img = Image.new("RGBA", (size, size), BG + (255,))
    draw = ImageDraw.Draw(img)
    for (x, y), c in lit.items():
        draw.rectangle([x * cell, y * cell, (x + 1) * cell - 1, (y + 1) * cell - 1], fill=c + (255,))
    # Rounded corners: a 4x supersampled mask, so the edge is smooth.
    big = size * 4
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 3.5 / 16), fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img


def main():
    root = Path(__file__).resolve().parent.parent
    out = root / "icons"
    out.mkdir(exist_ok=True)
    lit = cells()
    (out / "icon.svg").write_text(svg(lit), encoding="utf-8", newline="\n")
    for size in (16, 32, 48, 128):
        png(lit, size).save(out / f"icon-{size}.png", optimize=True)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
