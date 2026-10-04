"""Measures where the duck lands the bed under the voice, from what `duck.check.liq` rendered.

Writes the three tones the harness plays, runs it in the pinned Liquidsoap image (Docker, no dev
stack needed), and reads each tone's level back off the render. See stream/README.md.

A mono sine of amplitude A below the K-weighting shelf measures 20*log10(A) - 3.7 LUFS, which is
how the tones are sized and how a level read off the render is reported.
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

BED_HZ = 440.0
VOICE_HZ = 700.0
QUIET_LUFS = -30.0
LOUD_LUFS = -8.0
VOICE_LUFS = -15.0
DUCK_GAIN_DB = -12.0


def amplitude(lufs: float) -> float:
    return 10 ** ((lufs + 3.7) / 20)


def lufs(amp: float) -> float:
    return 20 * math.log10(max(amp, 1e-9)) - 3.7


def tone(path: str, hz: float, seconds: float, lufs_: float) -> None:
    amp = amplitude(lufs_)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(
            b"".join(int(amp * 32767 * math.sin(2 * math.pi * hz * i / RATE)).to_bytes(2, "little", signed=True) for i in range(int(RATE * seconds)))
        )


def level(samples: array, hz: float, at: float, span: float = 0.1) -> float:
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
        tone(os.path.join(work, "quiet.wav"), BED_HZ, 10.0, QUIET_LUFS)
        tone(os.path.join(work, "loud.wav"), BED_HZ, 10.0, LOUD_LUFS)
        tone(os.path.join(work, "voice.wav"), VOICE_HZ, 4.0, VOICE_LUFS)
        with open(os.path.join(HERE, "duck.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())

        subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", "timeout 40 liquidsoap /w/check.liq >/dev/null 2>&1"],
            check=False,
        )

        with wave.open(os.path.join(work, "duck.check.wav")) as rendered:
            samples = array("h")
            samples.frombytes(rendered.readframes(rendered.getnframes()))

    halves = []
    for name, start in (("quiet", 0.0), ("loud", 10.0)):
        full = lufs(level(samples, BED_HZ, start + 1.5))
        ducked = lufs(level(samples, BED_HZ, start + 5.0))
        voice = lufs(level(samples, VOICE_HZ, start + 5.0))
        back = lufs(level(samples, BED_HZ, start + 8.5))
        halves.append((name, full, ducked, voice, back))
        print(f"{name:5}  bed {full:6.1f}  under voice {ducked:6.1f} ({ducked - full:+5.1f} dB)  voice {voice:6.1f}  gap {voice - ducked:5.1f} LU  after {back:6.1f}")

    gaps = [voice - ducked for _, _, ducked, voice, _ in halves]
    print(f"the gap under the voice differs by {abs(gaps[0] - gaps[1]):.1f} dB between the halves")

    checks = [
        ("the voice is at its level", all(abs(voice - VOICE_LUFS) < 1.0 for *_, voice, _ in halves)),
        ("the bed drops by DUCK_GAIN_DB in both halves", all(abs((ducked - full) - DUCK_GAIN_DB) < 1.0 for _, full, ducked, _, _ in halves)),
        ("the bed comes back up after each break", all(abs(back - full) < 1.0 for _, full, _, _, back in halves)),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
