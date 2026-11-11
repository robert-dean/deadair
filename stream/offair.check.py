"""Checks what a stand-down leaves behind, from what `offair.check.liq` rendered.

Writes the tones the harness plays and runs it twice in the pinned Liquidsoap image (Docker, no dev
stack needed): once as `radio.liq` does it, draining the programme after `/control/offair`, and once
without the drain, as the station was before it. Reads the level of each tone after the next
listener's return, and the titles that reached the mount. See stream/README.md.
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
OLD_HZ = 440.0
NEW_HZ = 660.0
VOICE_HZ = 880.0
BED_HZ = 1300.0
RETURN_AT = 30.0


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


def run(work: str, drain: bool) -> tuple[array, list[tuple[float, str]]]:
    done = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", f"OFFAIR_DRAIN={int(drain)} timeout 60 liquidsoap /w/check.liq 2>&1"],
        check=False,
        capture_output=True,
        text=True,
    )
    labels = []
    for line in done.stdout.splitlines():
        if line.startswith("label "):
            _, at, title = line.split(" ", 2)
            labels.append((float(at), title))
    with wave.open(os.path.join(work, "offair.check.wav")) as rendered:
        samples = array("h")
        samples.frombytes(rendered.readframes(rendered.getnframes()))
    return samples, labels


def main() -> int:
    with tempfile.TemporaryDirectory() as work:
        tone(os.path.join(work, "old.wav"), OLD_HZ, 40.0)
        tone(os.path.join(work, "new.wav"), NEW_HZ, 30.0)
        tone(os.path.join(work, "voice.wav"), VOICE_HZ, 30.0)
        tone(os.path.join(work, "bed.wav"), BED_HZ, 30.0)
        with open(os.path.join(HERE, "offair.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())
        drained, drained_labels = run(work, drain=True)
        stale, stale_labels = run(work, drain=False)

    after = [RETURN_AT + 0.5 + 0.5 * i for i in range(18)]
    heard = [t for t in after if t >= RETURN_AT + 1.0]

    def loudest(samples: array, hz: float, times: list[float]) -> float:
        return max(level(samples, hz, t) for t in times)

    def titles_after(labels: list[tuple[float, str]]) -> list[str]:
        return [title for at, title in labels if at >= RETURN_AT - 0.5]

    checks = [
        ("the old record airs before the stand-down", level(drained, OLD_HZ, 10.0) > 0.45),
        ("nothing airs while the station is down", loudest(drained, OLD_HZ, [18.0, 22.0, 26.0]) < 0.02 and loudest(drained, VOICE_HZ, [18.0, 22.0, 26.0]) < 0.02),
        ("the new record airs on the return", min(level(drained, NEW_HZ, t) for t in heard) > 0.45),
        ("no tail of the old record in front of it", loudest(drained, OLD_HZ, after) < 0.02),
        ("no old talk-over in front of it", loudest(drained, VOICE_HZ, after) < 0.02),
        ("the local bed never reached", loudest(drained, BED_HZ, after + [18.0, 22.0, 26.0]) < 0.02),
        ("only the new title reaches the mount", titles_after(drained_labels) == ["new record"]),
        ("without the drain the old tail airs (the check can see it)", loudest(stale, OLD_HZ, after) > 0.2),
        ("and the old titles reach the mount", any(title != "new record" for title in titles_after(stale_labels))),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(
        f"drained: old {loudest(drained, OLD_HZ, after):.2f} voice {loudest(drained, VOICE_HZ, after):.2f} titles {titles_after(drained_labels)}  "
        f"undrained: old {loudest(stale, OLD_HZ, after):.2f} titles {titles_after(stale_labels)}"
    )
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
