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

And it writes the menu-bar icon, `Assets/tray-mark.png`, which is a different problem. A menu-bar
icon is a TEMPLATE: black and transparent only, and macOS paints it the menu bar's own colour, light
or dark. A plain silhouette of the drawing would be a blob with headphones, because what makes it a
skull is the dark eyes, nose and teeth inside the cream. So the whole drawing is kept, and every dark
patch the cream surrounds is cut out of it; the dark patches that reach the green (the headphones and
the outline) stay solid. It is 44 pixels, the 2x of the 22 points a menu-bar icon is drawn at.
"""

import os
import shutil
import subprocess
import sys
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


TRAY = os.path.join(ASSETS, 'tray-mark.png')
TRAY_SIZE = 44          # pixels: the 2x of a 22-point menu-bar icon
LIGHT = 400             # r + g + b above which a pixel of the drawing is the cream of the skull


def is_field(pixel):
    r, g, b, a = pixel
    return a < 40 or abs(r - GREEN[0]) + abs(g - GREEN[1]) + abs(b - GREEN[2]) <= FIELD_TOLERANCE


def template(mark):
    """The drawing as black on transparent, with the dark shapes inside the cream cut out."""
    width, height = mark.size
    px = mark.load()

    drawing = [[not is_field(px[x, y]) for x in range(width)] for y in range(height)]
    dark = [[drawing[y][x] and sum(px[x, y][:3]) <= LIGHT for x in range(width)] for y in range(height)]

    # A dark patch is a hole when no pixel of it touches the field: the cream is all around it.
    holes = [[False] * width for _ in range(height)]
    seen = [[False] * width for _ in range(height)]
    for sy in range(height):
        for sx in range(width):
            if not dark[sy][sx] or seen[sy][sx]:
                continue
            patch, stack, reaches_field = [], [(sx, sy)], False
            seen[sy][sx] = True
            while stack:
                x, y = stack.pop()
                patch.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if not (0 <= nx < width and 0 <= ny < height) or not drawing[ny][nx]:
                        reaches_field = True
                    elif dark[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if not reaches_field:
                for x, y in patch:
                    holes[y][x] = True

    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    opx = out.load()
    for y in range(height):
        for x in range(width):
            if drawing[y][x] and not holes[y][x]:
                opx[x, y] = (0, 0, 0, 255)

    box = out.getbbox()
    out = out.crop(box)
    side = max(out.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.alpha_composite(out, ((side - out.size[0]) // 2, (side - out.size[1]) // 2))
    return square.resize((TRAY_SIZE, TRAY_SIZE), Image.LANCZOS)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--tray-only':
        template(Image.open(MARK).convert('RGBA')).save(TRAY)
        print(f'wrote {TRAY}')
        return

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

    template(Image.open(MARK).convert('RGBA')).save(TRAY)
    print(f'wrote {TRAY}')


if __name__ == '__main__':
    main()
