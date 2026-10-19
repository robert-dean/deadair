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
# The harness's duck settings, which are `radio.default.env`'s.
DUCK_BED_LUFS = -25.0
DUCK_MIN_DB = -3.0
# What the harness stamps on the last cue, as the app does.
STAMPED_BED_LUFS = -23.0


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
        tone(os.path.join(work, "loud.wav"), BED_HZ, 12.0, LOUD_LUFS)
        tone(os.path.join(work, "voice.wav"), VOICE_HZ, 4.0, VOICE_LUFS)
        with open(os.path.join(HERE, "duck.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())

        subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", "timeout 45 liquidsoap /w/check.liq >/dev/null 2>&1"],
            check=False,
        )

        with wave.open(os.path.join(work, "duck.check.wav")) as rendered:
            samples = array("h")
            samples.frombytes(rendered.readframes(rendered.getnframes()))

    # name, the bed at full before the break, the bed under the voice, the voice, the bed after.
    breaks = []
    for name, full_at, under_at, back_at in (("quiet", 1.5, 5.0, 7.7), ("kick", 7.5, 11.0, 13.0), ("loud", 14.0, 17.0, 20.0)):
        full = lufs(level(samples, BED_HZ, full_at))
        ducked = lufs(level(samples, BED_HZ, under_at))
        voice = lufs(level(samples, VOICE_HZ, under_at))
        back = lufs(level(samples, BED_HZ, back_at))
        breaks.append((name, full, ducked, voice, back))
        print(f"{name:5}  bed {full:6.1f}  under voice {ducked:6.1f}  voice {voice:6.1f}  gap {voice - ducked:5.1f} LU  after {back:6.1f}")

    quiet, kick, loud = breaks
    print(f"the gap under the voice differs by {abs((quiet[3] - quiet[2]) - (loud[3] - loud[2])):.1f} dB between the quiet and loud beds")

    checks = [
        ("the voice is at its level", all(abs(voice - VOICE_LUFS) < 1.0 for *_, voice, _ in breaks)),
        # Already under the target, so it dips by the shallowest a duck may be and no further.
        ("the quiet bed dips by DUCK_MIN_DB", abs((quiet[2] - quiet[1]) - DUCK_MIN_DB) < 1.0),
        # Over the target, so it is pulled down to it rather than by a fixed amount, and to the
        # cue's own figure rather than the fallback.
        ("the loud bed lands at the level stamped on its cue", abs(loud[2] - STAMPED_BED_LUFS) < 1.5),
        # A second after the record kicks in under the voice it is already most of the way down.
        ("a record kicking in under the voice is pulled down within a second", abs(kick[2] - DUCK_BED_LUFS) < 3.0),
        ("the bed comes back up after each break", abs(quiet[4] - quiet[1]) < 1.0 and abs(kick[4] - LOUD_LUFS) < 1.0 and abs(loud[4] - loud[1]) < 1.0),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
