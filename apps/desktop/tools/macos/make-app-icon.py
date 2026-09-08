#!/usr/bin/env python3
"""Build the desktop app's icon from the console's logo.

Run after `apps/web/public/logo.png` or `logo-mark.png` changes, from anywhere:

    python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install Pillow
    /tmp/iconvenv/bin/python apps/desktop/tools/macos/make-app-icon.py

Pillow is the only dependency and is deliberately not a project one, exactly as in
`apps/android/tools/make-launcher-icon.py`: this runs by hand on the rare day the mark changes, and
nothing in the build calls it. What it writes is committed, so `make-app-bundle.sh` needs neither
Python nor Pillow and CI packages the app without either.

Why a script rather than a note saying "export it". Three things have to happen and each is easy to
get subtly wrong by hand:

  * The disc is INSET rather than run to the edge of the canvas. macOS draws every app icon inside
    a shared grid so a dock of them reads as one row: for a 1024 canvas the grid's square is 824
    across and its circle is 858, larger, because a circle of the square's width reads smaller than
    it is. This mark is a circle, so 858 is its size and the 83 pixels of transparency around it are
    not wasted margin — they are what stops it looming a size bigger than everything beside it.
  * The SMALL entries are the mark rather than the lockup. Below about 64 pixels the arched
    "deadair radio" is mush, and an icon whose ring of type has turned to noise looks broken rather
    than small. `logo-mark.png` is the same badge with the skull alone, which is what the console
    header and the Android launcher already do at their small sizes and for the same reason. The
    two never appear at once: nothing on macOS shows a 64 and a 128 side by side.
  * Only the 1024 entry is an upscale, and it is the one nothing looks at closely. The lockup
    source is 512, so every size the dock and the switcher use is a downscale from it; 1024 exists
    for Finder's gallery view, where LANCZOS from 512 still beats letting macOS scale the 512 entry
    itself.

It also copies the mark into the app's `Assets/`, where `Window.Icon` and the sidebar's title strip
read it from. That is a second copy of a file the console already has, which is the same trade
`apps/android` makes: the alternative is a build step reaching across the tree into a directory this
solution deliberately does not know about.
"""

import os
import shutil
import subprocess
import tempfile

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
LOCKUP = os.path.join(ROOT, 'apps/web/public/logo.png')
MARK = os.path.join(ROOT, 'apps/web/public/logo-mark.png')
ICNS = os.path.join(ROOT, 'apps/desktop/tools/macos/deadair.icns')
ASSETS = os.path.join(ROOT, 'apps/desktop/src/MaroonedSoftware.Deadair.Desktop/Assets')

DISC = 858 / 1024  # the icon grid's circle, as a fraction of the canvas
SIMPLIFY_BELOW = 128  # canvases smaller than this get the mark, not the lockup

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


def render(source, canvas):
    """The disc at the grid's size, centred on a transparent canvas of `canvas` pixels."""
    diameter = round(canvas * DISC)
    disc = source.resize((diameter, diameter), Image.LANCZOS)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    offset = (canvas - diameter) // 2
    out.paste(disc, (offset, offset))
    return out


def main():
    lockup = Image.open(LOCKUP).convert('RGBA')
    mark = Image.open(MARK).convert('RGBA')

    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'deadair.iconset')
        os.mkdir(iconset)
        for name, size in ENTRIES:
            render(mark if size < SIMPLIFY_BELOW else lockup, size).save(os.path.join(iconset, name))
        subprocess.run(['iconutil', '--convert', 'icns', '--output', ICNS, iconset], check=True)
    print(f'wrote {ICNS}')

    shutil.copyfile(MARK, os.path.join(ASSETS, 'logo-mark.png'))
    print(f'wrote {os.path.join(ASSETS, "logo-mark.png")}')


if __name__ == '__main__':
    main()
