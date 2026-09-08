#!/usr/bin/env python3
"""Build the desktop app's icon from the console's mark.

Run after `apps/web/public/logo-mark.png` changes, from anywhere:

    python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install Pillow
    /tmp/iconvenv/bin/python apps/desktop/tools/macos/make-app-icon.py

Pillow is the only dependency and is deliberately not a project one, exactly as in
`apps/android/tools/make-launcher-icon.py`: this runs by hand on the rare day the mark changes, and
nothing in the build calls it. What it writes is committed, so `make-app-bundle.sh` needs neither
Python nor Pillow and CI packages the app without either.

Why a script rather than a note saying "export it". Three things have to happen and each is easy to
get subtly wrong by hand:

  * The icon is a FULL-BLEED SQUARE and not the circular badge. macOS 26 draws every app icon as one
    rounded square and supplies that mask itself; artwork that does not fill its canvas is set on the
    system's own light grey plate instead. That is what the first version of this icon did — a green
    disc floating on grey, inset and washed out beside everything else in the dock — and it was
    written here as a virtue, because the pre-26 grid really did work that way. Asking `NSWorkspace`
    what it draws for a BUILT BUNDLE is how it was caught, and it is the only honest check: what the
    .icns holds and what a Mac shows are two different pictures.
  * So the skull is LIFTED off the mark and set on a field of the mark's own green, which the system
    then cuts to its rounded square. Lifted rather than cropped, because the badge's ring of green
    and the square's corners are the same colour and a crop would leave the disc's edge inside the
    art. Same keying as the Android launcher, down to the sampled green and the tolerance.
  * It sits at 72% of the canvas. Apple's own proportions are nearer 62 and that is what most icons
    use, including the ones this was compared against; this one is a single heavy silhouette rather
    than a detailed drawing, and at 32px in a dock the extra 10% is the difference between a skull
    and a smudge. The headphones still clear the mask. Both were rendered through the real mask and
    looked at before choosing, which is the only way this question can be answered.

It also copies the mark into the app's `Assets/`, where `Window.Icon` reads it — that keeps the
circular badge, which is the shape the mark was drawn as. That is a second copy of a file the console
already has, which is the same trade `apps/android` makes: the alternative is a build step reaching
across the tree into a directory this solution deliberately does not know about.
"""

import os
import shutil
import subprocess
import tempfile

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
MARK = os.path.join(ROOT, 'apps/web/public/logo-mark.png')
ICNS = os.path.join(ROOT, 'apps/desktop/tools/macos/deadair.icns')
ASSETS = os.path.join(ROOT, 'apps/desktop/src/MaroonedSoftware.Deadair.Desktop/Assets')

GREEN = (47, 217, 140)  # the mark's field, sampled rather than chosen. The launcher's own value.
FIELD_TOLERANCE = 60    # colour distance beyond which a pixel is not the field
SKULL_WIDTH = 0.72      # of the canvas

# The names iconutil expects. A size appears twice when it is both a 2x of one point size and the 1x
# of the next; the file is written twice and is identical, which is what the format wants.
ENTRIES = [
    ('icon_16x16.png', 16),
    ('icon_16x16@2x.png', 32),
    ('icon_32x32.png', 32),
    ('icon_32x32@2x.png', 64),
    ('icon_128x128.png', 128),
    ('icon_128x128@2x.png', 256),
    ('icon_256x256.png', 256),
    ('icon_256x256@2x.png', 512),
    ('icon_512x512.png', 512),
    ('icon_512x512@2x.png', 1024),
]


def lift_skull(mark):
    """The drawing alone: everything in the badge that is not its field, at its own bounds."""
    width, height = mark.size
    px = mark.load()
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            if a >= 40 and abs(r - GREEN[0]) + abs(g - GREEN[1]) + abs(b - GREEN[2]) > FIELD_TOLERANCE:
                xs.append(x)
                ys.append(y)
    return mark.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))


def render(skull, canvas):
    """The skull centred on a field of the mark's green, filling the canvas edge to edge."""
    out = Image.new('RGBA', (canvas, canvas), GREEN + (255,))
    width = round(canvas * SKULL_WIDTH)
    height = max(1, round(skull.size[1] * width / skull.size[0]))
    out.alpha_composite(skull.resize((width, height), Image.LANCZOS), ((canvas - width) // 2, (canvas - height) // 2))
    return out


def main():
    skull = lift_skull(Image.open(MARK).convert('RGBA'))

    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'deadair.iconset')
        os.mkdir(iconset)
        for name, size in ENTRIES:
            render(skull, size).save(os.path.join(iconset, name))
        subprocess.run(['iconutil', '--convert', 'icns', '--output', ICNS, iconset], check=True)
    print(f'wrote {ICNS}')

    shutil.copyfile(MARK, os.path.join(ASSETS, 'logo-mark.png'))
    print(f'wrote {os.path.join(ASSETS, "logo-mark.png")}')


if __name__ == '__main__':
    main()
