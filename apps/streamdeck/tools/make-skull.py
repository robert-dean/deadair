#!/usr/bin/env python3
"""Lift the skull off the console's mark, for the vote keys to draw inside their heart and the category icon.

Run after `apps/web/public/logo-mark.png` changes, from anywhere:

    python3 -m venv /tmp/skullvenv && /tmp/skullvenv/bin/pip install Pillow
    /tmp/skullvenv/bin/python apps/streamdeck/tools/make-skull.py

Pillow is the only dependency and is deliberately not a project one, exactly as in
`apps/desktop/tools/macos/make-app-icon.py` and `apps/android/tools/make-launcher-icon.py`: this runs
by hand on the rare day the mark changes, and nothing in the build calls it. What it writes is
committed, so the plugin's build needs neither Python nor Pillow.

It writes `imgs/plugin/skull.png`: the drawing ALONE on transparency, which the Like and Dislike
keys draw inside their heart — the heart standing in for the badge's own green disc. It is read off
the plugin folder at start, as `mark.png` beside it already is, rather than bundled.

It also writes `imgs/plugin/category-icon.png` and its `@2x`: the heading the app draws over the
plugin's actions in its sidebar. Elgato wants that white and monochrome on transparency, so it cannot be
the mark itself, and it was a hand-drawn pair of headphones that looked like nobody's. It is the same
drawing as a SILHOUETTE instead: the bone solid white with the eyes, nose and jaw punched through,
and the headphones solid white beside it, held apart from the skull by a gap cut around the skull's
outline. At 28 pixels that gap is what makes them read as headphones rather than as a wider head.
The mark's shading is hatched, and each hatch would be a speck at this size, so the bone is closed
and median-filtered before it is filled, which costs the teeth. They do not survive 28 pixels anyway.

`mark.png` is NOT written here. It is the badge as it is, copied in when the mark changes, and
rewriting it through a resize would churn a committed file for nothing.

**The keying is the whole job, and it is not the desktop's.** That script lifts the skull by cropping
to the drawing's bounds and composites the result straight back onto a field of the same green, so
field-coloured pixels left inside the crop are invisible. These keys put the skull on a RED heart as
often as a green one, where every one of those pixels would show as a green fringe. So the field is
made TRANSPARENT here rather than merely cropped, and the edge between the cream and the field is
feathered: a pixel well inside the field is clear, one well outside it is opaque, and one in between
takes an alpha in proportion. Keying hard instead leaves a one-pixel green halo that is invisible on
green and obvious on red.
"""

import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
MARK = os.path.join(ROOT, 'apps/web/public/logo-mark.png')
PLUGIN = os.path.join(ROOT, 'apps/streamdeck/radio.deadair.streamdeck.sdPlugin/imgs/plugin')

GREEN = (47, 217, 140)  # the mark's field, sampled rather than chosen. The launcher's own value.
CLEAR = 60              # colour distance at or under which a pixel IS the field
SOLID = 150             # colour distance at or over which a pixel is the drawing
SKULL_SIZE = 144        # a vote key draws it at about 68 of its 144 units, so this is 2x what it needs


def distance(pixel):
    r, g, b, _ = pixel
    return abs(r - GREEN[0]) + abs(g - GREEN[1]) + abs(b - GREEN[2])


def lift(mark):
    """The drawing alone on transparency, cropped to its own bounds, with a feathered edge."""
    width, height = mark.size
    px = mark.load()
    out = Image.new('RGBA', mark.size, (0, 0, 0, 0))
    op = out.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            d = distance(px[x, y])
            if d <= CLEAR:
                continue
            keep = 255 if d >= SOLID else round(255 * (d - CLEAR) / (SOLID - CLEAR))
            op[x, y] = (r, g, b, min(a, keep))
    return out.crop(out.getbbox())


def square(image, size):
    """Centred on a transparent square canvas, so the SVG can place it without knowing its shape."""
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    width = size if image.size[0] >= image.size[1] else round(image.size[0] * size / image.size[1])
    height = round(image.size[1] * width / image.size[0])
    out.alpha_composite(image.resize((width, height), Image.LANCZOS), ((size - width) // 2, (size - height) // 2))
    return out


def threshold(image, keep):
    """A mask of the pixels `keep` accepts."""
    out = Image.new('L', image.size, 0)
    px, op = image.load(), out.load()
    for y in range(image.size[1]):
        for x in range(image.size[0]):
            if keep(px[x, y]):
                op[x, y] = 255
    return out


def closed(mask, size=3):
    """Specks and hatching shut, so the silhouette has no holes the drawing did not mean."""
    return mask.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.MinFilter(size))


def silhouette(mark):
    """The drawing in white alone, for the category icon: the bone with its holes, the headphones apart."""
    drawing = closed(threshold(mark, lambda p: p[3] > 128 and distance(p) > 100))
    bone = closed(threshold(mark, lambda p: p[3] > 128 and distance(p) > 100 and p[0] + p[1] + p[2] > 420))
    bone = bone.filter(ImageFilter.MedianFilter(3))
    # The skull with its holes filled: flood the outside, and whatever the flood did not reach is skull.
    width, height = mark.size
    padded = Image.new('L', (width + 2, height + 2), 0)
    padded.paste(bone, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    skull = padded.crop((1, 1, width + 1, height + 1)).point(lambda v: 0 if v == 128 else 255)
    # The headphones are the rest of the drawing, less a gap around the skull so the two stay apart.
    headphones = ImageChops.subtract(drawing, skull.filter(ImageFilter.MaxFilter(7))).filter(ImageFilter.MedianFilter(5))
    alpha = ImageChops.lighter(bone, headphones)
    alpha = alpha.crop(alpha.getbbox())
    out = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    return out


mark = Image.open(MARK).convert('RGBA')
square(lift(mark), SKULL_SIZE).save(os.path.join(PLUGIN, 'skull.png'))
print('radio.deadair.streamdeck.sdPlugin/imgs/plugin/skull.png')

icon = silhouette(mark)
for name, size in (('category-icon.png', 28), ('category-icon@2x.png', 56)):
    square(icon, size).save(os.path.join(PLUGIN, name))
    print(f'radio.deadair.streamdeck.sdPlugin/imgs/plugin/{name}')
