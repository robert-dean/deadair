"""Checks a record cut short for a hard marker from what `cut.check.liq` rendered.

Writes the three tones the harness plays, runs it in the pinned Liquidsoap image (Docker, no dev stack
needed), and reads the level of each tone back off the render. See stream/README.md.
"""

import math
import os
import subprocess
import sys
import tempfile
import wave
from array import array

RATE = 44_100
IMAGE = "savonet/liquidsoap:v2.4.5"
HERE = os.path.dirname(os.path.abspath(__file__))
# The cut tone is cut six seconds after it starts, and fades over the last three. Measured from where it
# starts rather than from the top of the render, which the queue reaches a fraction of a second late.
CUT_AFTER = 6.0
FADE = 3.0


def tone(path: str, hz: float, seconds: float) -> None:
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(
            b"".join(int(0.5 * 32767 * math.sin(2 * math.pi * hz * i / RATE)).to_bytes(2, "little", signed=True) for i in range(int(RATE * seconds)))
        )


def level(samples: array, hz: float, at: float, span: float = 0.05) -> float:
    """Amplitude of one frequency over a short window, by correlation, so the tones separate."""
    start, end = int(at * RATE), int((at + span) * RATE)
    window = samples[start:end]
    if len(window) == 0:
        return 0.0
    re = sum(x * math.cos(2 * math.pi * hz * (start + i) / RATE) for i, x in enumerate(window))
    im = sum(x * math.sin(2 * math.pi * hz * (start + i) / RATE) for i, x in enumerate(window))
    return 2 * math.hypot(re, im) / len(window) / 32767


def main() -> int:
    with tempfile.TemporaryDirectory() as work:
        tone(os.path.join(work, "lead.wav"), 300.0, 2.0)
        tone(os.path.join(work, "first.wav"), 440.0, 10.0)
        tone(os.path.join(work, "second.wav"), 1300.0, 10.0)
        with open(os.path.join(HERE, "cut.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())

        subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", "timeout 30 liquidsoap /w/check.liq >/dev/null 2>&1"],
            check=False,
        )

        with wave.open(os.path.join(work, "cut.check.wav")) as rendered:
            samples = array("h")
            samples.frombytes(rendered.readframes(rendered.getnframes()))

    # Where the cut tone becomes audible, to the nearest hundredth of a second.
    onset = next(t / 100 for t in range(0, 500) if level(samples, 440.0, t / 100, span=0.01) > 0.25)
    cut_at = onset + CUT_AFTER
    before = level(samples, 440.0, cut_at - FADE - 0.5)
    fading = [level(samples, 440.0, cut_at - FADE + t) for t in (0.2, 1.0, 1.8, 2.6)]
    after = max(level(samples, 440.0, cut_at + t) for t in (0.05, 0.3, 0.6))
    second = level(samples, 1300.0, cut_at + 0.05)

    checks = [
        ("the cut tone is at full level before its fade", before > 0.45),
        ("it falls at every step of the fade", all(a > b for a, b in zip(fading, fading[1:]))),
        ("nothing of it is heard after the cut", after < 0.05),
        ("the next tone starts at full level on the cut", second > 0.45),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"cut tone from {onset:.2f}s, cut at {cut_at:.2f}s")
    print(f"before: {before:.2f}  fading: {', '.join(f'{x:.2f}' for x in fading)}  after cut: {after:.2f}  next: {second:.2f}")

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
