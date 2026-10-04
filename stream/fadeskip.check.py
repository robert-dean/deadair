"""Checks a faded cut from what `fadeskip.check.liq` rendered.

Writes the two tones the harness plays, runs it in the pinned Liquidsoap image (Docker, no dev
stack needed), and reads the level of each tone back off the render. See stream/README.md.
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


def tone(path: str, hz: float, seconds: float) -> None:
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(
            b"".join(int(0.5 * 32767 * math.sin(2 * math.pi * hz * i / RATE)).to_bytes(2, "little", signed=True) for i in range(int(RATE * seconds)))
        )


def level(samples: array, hz: float, at: float, span: float = 0.05) -> float:
    """Amplitude of one frequency over a short window, by correlation, so the two tones separate."""
    start, end = int(at * RATE), int((at + span) * RATE)
    window = samples[start:end]
    if len(window) == 0:
        return 0.0
    re = sum(x * math.cos(2 * math.pi * hz * (start + i) / RATE) for i, x in enumerate(window))
    im = sum(x * math.sin(2 * math.pi * hz * (start + i) / RATE) for i, x in enumerate(window))
    return 2 * math.hypot(re, im) / len(window) / 32767


def main() -> int:
    with tempfile.TemporaryDirectory() as work:
        tone(os.path.join(work, "first.wav"), 440.0, 10.0)
        tone(os.path.join(work, "second.wav"), 1300.0, 10.0)
        with open(os.path.join(HERE, "fadeskip.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())

        subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", "timeout 30 liquidsoap /w/check.liq >/dev/null 2>&1"],
            check=False,
        )

        with wave.open(os.path.join(work, "fadeskip.check.wav")) as rendered:
            samples = array("h")
            samples.frombytes(rendered.readframes(rendered.getnframes()))

    first = [level(samples, 440.0, t) for t in (0.5, 1.5, 2.0, 2.5, 2.9)]
    after = max(level(samples, 440.0, t) for t in (3.1, 3.2, 3.3, 3.4))
    second = level(samples, 1300.0, 4.0)

    checks = [
        ("the first tone is at full level before the fade", first[0] > 0.45),
        ("it falls at every step of the fade", all(a > b for a, b in zip(first, first[1:]))),
        ("nothing of it is heard at full level after the cut", after < 0.1),
        ("the second tone starts at full level", second > 0.45),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"first: {', '.join(f'{x:.2f}' for x in first)}  after cut: {after:.2f}  second: {second:.2f}")

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
