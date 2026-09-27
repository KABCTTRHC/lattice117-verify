"""
Regenerates every Lattice117 and BSG brand asset from its master, deterministically.

## Two brands

**Brierley Sovereign Group (BSG) is the company. Lattice117 is the product.**
They are never interchangeable and never appear at the same weight: the splash
screen presents BSG first and hands off to Lattice117, which is what the rest of
the product then wears.

The BSG masters are white line art on a black field, so this script keys black
to alpha rather than shipping them with a baked background — a mark that can
only sit on black is a mark that cannot go in a light-themed deck. The key takes
the per-pixel channel maximum as coverage and forces RGB to pure white, so JPEG
ringing around the strokes cannot tint it.

WHY A GENERATOR RATHER THAN NINE COMMITTED PNGS AND A PRAYER. The same reason
`tools/fixture/nottingham.mjs` and `tools/fixture/convex.mjs` exist: an asset
that was hand-produced once cannot be re-derived, so nobody can tell whether
the 32px icon is a scaled version of the 512px one or a different drawing that
drifted. Everything here comes from `brand/lattice117-mark-master.webp`, and
running this script again reproduces the same bytes.

## Two artworks, and where the line is

The full mark carries a wordmark inside the gear rim. Rendered at 32px that
wordmark is four grey smudges — it costs contrast and returns nothing, and the
lattice and the wave go with it. Measured rather than assumed: at 128px the
wordmark is legible and at 80px it is not.

So there are two families and the cutoff is 128px:

  * **glyph** (16-80) — the emblem, cropped to 72% of the master about a centre
    lifted to y=0.455 so the wordmark band falls outside, then re-masked to a
    circle. Keeping the circular silhouette matters: at 16px in a browser tab
    the shape IS the recognition, and a square crop would throw it away. The
    mask is drawn at 4x and downsampled, which is what gives it a clean edge
    rather than a staircase.
  * **mark** (128+) — the master, untouched, wordmark and rim included.

Both keep the master's genuine alpha, so they sit correctly on a light or a
dark page.

## Checking

`--check` re-renders into memory and compares. It is NOT wired into CI,
deliberately: this is a JavaScript repository and adding Python and Pillow to
the CI image to check twelve PNGs is disproportionate. What CI does check, in
tests/surfaces.test.mjs and with no new dependency, is that every icon a
surface REFERENCES actually exists and is non-empty — which is the defect class
that has actually bitten this project, when demo/sw.js shipped an offline shell
missing a file its own page imports.

    python3 tools/brand/icons.py            write
    python3 tools/brand/icons.py --check    fail if anything committed is stale

Requires Pillow.
"""
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parents[2]
MASTER = HERE / "brand" / "lattice117-mark-master.webp"

# The emblem crop, as fractions of the master. `CENTRE_Y` is above the middle
# because the wordmark band sits low; cropping about the true centre would
# clip the top of the lattice and keep half the lettering.
CROP_FRACTION = 0.72
CENTRE_Y = 0.455
WORDMARK_LEGIBLE_ABOVE = 128

# size -> paths. One size can land in several places; the Excel manifest and
# the Workspace store each dictate their own filenames.
TARGETS = {
    16:  ["brand/glyph-16.png", "excel-addin/assets/icon-16.png"],
    32:  ["brand/glyph-32.png", "excel-addin/assets/icon-32.png"],
    48:  ["brand/glyph-48.png"],
    64:  ["brand/glyph-64.png"],
    80:  ["brand/glyph-80.png", "excel-addin/assets/icon-80.png"],
    128: ["brand/mark-128.png", "store-assets/workspace/icon-128.png"],
    180: ["brand/mark-180.png"],          # apple-touch-icon
    192: ["brand/mark-192.png"],
    512: ["brand/mark-512.png"],
}

# Splash assets. WebP, because the splash ships inside the OFFLINE SHELL and a
# 512px mark is 450 KB as PNG against 75 KB as WebP — six times the shell for no
# visible difference at the size it renders. Every browser that can run the
# WebAssembly engine can decode WebP, so there is nothing to fall back to.
#
# The line-art marks use LOSSLESS WebP: they are thin white strokes on nothing,
# which is the exact case lossy compression ruins and lossless compresses well.
SPLASH = [
    # (source, output, width, lossless)
    ("master", "brand/mark-512.webp", 512, False),
    ("crest",  "brand/bsg-crest-560.webp", 560, True),
    ("seal",   "brand/bsg-seal-256.webp", 256, True),
]


def build_glyph(master: Image.Image) -> Image.Image:
    """The emblem, cropped clear of the wordmark and re-masked to a circle."""
    w, h = master.size
    side = int(w * CROP_FRACTION)
    cx, cy = w // 2, int(h * CENTRE_Y)
    crop = master.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))

    # Draw the mask at 4x and downsample it. Drawing an ellipse at the final
    # size gives a hard, aliased edge; this gives a real antialiased one.
    edge = 1024
    glyph = crop.resize((edge, edge), Image.LANCZOS)
    mask = Image.new("L", (edge * 4, edge * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, edge * 4 - 1, edge * 4 - 1), fill=255)
    glyph.putalpha(mask.resize((edge, edge), Image.LANCZOS))
    return glyph


def key_black(path: Path) -> Image.Image:
    """White line art on a black field -> transparent white.

    Luminance IS the coverage for this artwork, so the per-pixel channel
    maximum becomes alpha and RGB is forced to white. Taking the max rather
    than a luminance weighting means a slight colour cast still keys cleanly;
    forcing white means JPEG ringing around a stroke cannot tint it.
    """
    im = Image.open(path).convert("RGB")
    r, g, b = im.split()
    alpha = ImageChops.lighter(ImageChops.lighter(r, g), b)
    out = Image.new("RGB", im.size, (255, 255, 255)).convert("RGBA")
    out.putalpha(alpha)
    # Trim to the ink. A mark with an arbitrary margin baked in cannot be
    # aligned against anything.
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    return out.crop(bbox)


def render(source: Image.Image, size: int) -> bytes:
    """One resample, one encode. No metadata, so the bytes are stable."""
    out = source.resize((size, size), Image.LANCZOS)
    buf = BytesIO()
    # optimize=True is deterministic in Pillow; no timestamps are written.
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def main() -> int:
    check = "--check" in sys.argv
    master = Image.open(MASTER).convert("RGBA")
    if master.size[0] != master.size[1]:
        print(f"master is {master.size}, expected a square", file=sys.stderr)
        return 1

    glyph = build_glyph(master)

    stale, written = [], 0
    for size, paths in sorted(TARGETS.items()):
        source = master if size >= WORDMARK_LEGIBLE_ABOVE else glyph
        data = render(source, size)
        for rel in paths:
            path = HERE / rel
            if check:
                if not path.exists() or path.read_bytes() != data:
                    stale.append(rel)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                written += 1

    # Splash assets, from three different masters.
    sources = {
        "master": master,
        "crest": key_black(HERE / "brand" / "bsg-crest-master.jpg"),
        "seal": key_black(HERE / "brand" / "bsg-seal-master.png"),
    }
    for key, rel, width, lossless in SPLASH:
        src = sources[key]
        height = round(src.size[1] * width / src.size[0])
        buf = BytesIO()
        src.resize((width, height), Image.LANCZOS).save(
            buf, format="WEBP", method=6, **({"lossless": True} if lossless else {"quality": 88})
        )
        data = buf.getvalue()
        path = HERE / rel
        if check:
            if not path.exists() or path.read_bytes() != data:
                stale.append(rel)
        else:
            path.write_bytes(data)
            written += 1

    if check:
        if stale:
            print("stale or missing icons:", file=sys.stderr)
            for rel in stale:
                print(f"  {rel}", file=sys.stderr)
            print("\nrun: python3 tools/brand/icons.py", file=sys.stderr)
            return 1
        print(f"all {sum(len(v) for v in TARGETS.values()) + len(SPLASH)} brand assets match their masters")
        return 0

    print(f"wrote {written} icons from {MASTER.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
