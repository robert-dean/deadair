#!/usr/bin/env python3
"""Build the launcher icon's layers from the console's logo.

Run after `apps/web/public/logo.png` changes, from anywhere:

    python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install Pillow
    /tmp/iconvenv/bin/python apps/android/tools/make-launcher-icon.py

Pillow is the only dependency and is deliberately not a project one: this runs by hand on the rare
day the mark changes, and nothing in the Gradle build calls it. The PNGs it writes are committed.

Why this is a script rather than a note saying "export it from the design file". The layers are not
a crop of the lockup. Three things have to happen and each is easy to get subtly wrong by hand:

  * The skull is LIFTED off the lockup as the largest connected non-field component, which drops
    the twelve letters of the arched "deadair radio" without touching the drawing. `station.mark.tsx`
    made the same call for the console header, and for the same reason — at launcher size the type
    is illegible, and unlike the header there is no wordmark beside the icon to carry the name.
  * The field is keyed out with real alpha rather than a hard cut, so the rim carries no green
    fringe onto whatever a launcher puts behind it. A hard cut leaves a visible halo at 48dp.
  * The skull is scaled so its farthest ink sits at 30 of the 108dp canvas. That is 83% of the
    72dp a launcher actually shows, matching the proportion the console's mark uses, and it is
    inside the 66dp zone every mask is guaranteed to keep. The icon this replaced was drawn to
    the full canvas and had its corners clipped by circular masks.

It also writes the two pieces of Play store art that are the same mark, into `play/listing`, so the
store and the launcher cannot drift apart either:

  * The 512px store icon is the two layers composited and cropped to the 72dp a launcher shows. So
    it is the launcher icon as a phone draws it, before any mask, which is what Play asks for: a
    full-bleed square that Play rounds itself.
  * The 1024x500 feature graphic is the whole lockup, lettering included, on the same field. Here
    the name is legible and nothing else carries it.
"""

from collections import deque
import math
import os

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SRC = os.path.join(ROOT, 'apps/web/public/logo.png')
RES = os.path.join(ROOT, 'apps/android/app/src/main/res')
STORE = os.path.join(ROOT, 'apps/android/play/listing/en-US/images')

GREEN = (47, 217, 140)  # the mark's field, sampled rather than chosen. Also `ic_launcher_background`.
FIELD_TOLERANCE = 60    # colour distance beyond which a pixel is not the field
KEY_FULL = 150.0        # distance at which a pixel is wholly ink, for the alpha ramp between
TARGET_RADIUS = 30.0    # farthest ink, in 108dp units
DENSITIES = [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]


def largest_component(im):
    """The skull, as the biggest connected run of non-field pixels. The letters are their own."""
    w, h = im.size
    px = im.load()
    ink = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a >= 40 and abs(r - GREEN[0]) + abs(g - GREEN[1]) + abs(b - GREEN[2]) > FIELD_TOLERANCE:
                ink[y * w + x] = 1

    seen = bytearray(w * h)
    best = None
    for i in range(w * h):
        if not ink[i] or seen[i]:
            continue
        queue, cells = deque([i]), []
        seen[i] = 1
        while queue:
            c = queue.popleft()
            cells.append(c)
            cy, cx = divmod(c, w)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w:
                        j = ny * w + nx
                        if ink[j] and not seen[j]:
                            seen[j] = 1
                            queue.append(j)
        if best is None or len(cells) > len(best):
            best = cells
    return set(best)


def keyed(im, component):
    """The component with the field un-blended out of its anti-aliased rim."""
    w, h = im.size
    px = im.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    op = out.load()
    for c in component:
        y, x = divmod(c, w)
        r, g, b, a = px[x, y]
        alpha = min(1.0, (abs(r - GREEN[0]) + abs(g - GREEN[1]) + abs(b - GREEN[2])) / KEY_FULL)
        if alpha <= 0:
            continue
        # P = alpha*C + (1 - alpha)*field, solved for C.
        colour = tuple(max(0, min(255, round((p - (1 - alpha) * f) / alpha))) for p, f in zip((r, g, b), GREEN))
        op[x, y] = colour + (round(alpha * 255 * (a / 255)),)
    return out.crop(out.getbbox())


def layer(art, max_radius, size, monochrome=False):
    """One 108dp layer at `size` pixels, the skull centred and scaled into the safe zone."""
    scale = (TARGET_RADIUS / 108.0 * size) / max_radius
    w, h = max(1, round(art.size[0] * scale)), max(1, round(art.size[1] * scale))
    scaled = art.resize((w, h), Image.LANCZOS)
    if monochrome:
        # A themed icon is tinted flat, so the drawing has to survive as line work. Keeping the ink
        # and dropping the cream face reads as a skull; a filled silhouette reads as a blob.
        p = scaled.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = p[x, y]
                luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
                p[x, y] = (0, 0, 0, round(a * max(0.0, min(1.0, (0.62 - luminance) / 0.34))))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(scaled, ((size - w) // 2, (size - h) // 2), scaled)
    return out


def store_icon(art, max_radius):
    """512px, as a launcher draws the icon: both layers, cropped to the visible 72 of 108dp."""
    canvas = round(512 * 108 / 72)
    icon = Image.new('RGBA', (canvas, canvas), GREEN + (255,))
    icon.alpha_composite(layer(art, max_radius, canvas))
    inset = (canvas - 512) // 2
    return icon.crop((inset, inset, inset + 512, inset + 512))


def feature_graphic(source):
    """1024x500: the full lockup on its own field. Opaque, because Play refuses alpha here."""
    # Flattened onto the field BEFORE it is scaled. The lockup's corners are transparent black, and
    # resampling RGBA straight blends that black into the disc's rim, which drew a faint ring.
    flat = Image.new('RGBA', source.size, GREEN + (255,))
    flat.alpha_composite(source)
    side = 440
    graphic = Image.new('RGB', (1024, 500), GREEN)
    graphic.paste(flat.convert('RGB').resize((side, side), Image.LANCZOS), ((1024 - side) // 2, (500 - side) // 2))
    return graphic


def main():
    source = Image.open(SRC).convert('RGBA')
    art = keyed(source, largest_component(source))
    cx, cy = art.size[0] / 2.0, art.size[1] / 2.0
    pixels = art.load()
    max_radius = max(
        math.hypot(x - cx, y - cy) for y in range(art.size[1]) for x in range(art.size[0]) if pixels[x, y][3] > 24
    )
    print(f'skull {art.size[0]}x{art.size[1]}, farthest ink {max_radius:.1f}px from centre')

    for bucket, multiplier in DENSITIES:
        size = int(108 * multiplier)
        directory = os.path.join(RES, f'drawable-{bucket}')
        os.makedirs(directory, exist_ok=True)
        layer(art, max_radius, size).save(os.path.join(directory, 'ic_launcher_foreground.png'))
        layer(art, max_radius, size, monochrome=True).save(os.path.join(directory, 'ic_launcher_monochrome.png'))
        print(f'  drawable-{bucket}  {size}x{size}')

    os.makedirs(STORE, exist_ok=True)
    store_icon(art, max_radius).save(os.path.join(STORE, 'icon.png'))
    feature_graphic(source).save(os.path.join(STORE, 'featureGraphic.png'))
    print('  play store icon 512x512, feature graphic 1024x500')


if __name__ == '__main__':
    main()
