"""Checks a lease's warm-up from what `warmup.check.liq` rendered.

Writes the two tones the harness plays, runs it twice in the pinned Liquidsoap image (Docker, no dev
stack needed): once with the record arriving inside the warm-up, once with it arriving after the
allowance has gone. Reads the level of each tone back off the render, and the gap the starve watch
would have reported off its log. See stream/README.md.
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
RECORD_HZ = 440.0
BED_HZ = 1300.0


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


def run(work: str, push_at: float, warmup_s: float) -> tuple[array, list[str]]:
    env = f"WARMUP_PUSH_AT={push_at} PLAYOUT_WARMUP_S={warmup_s}"
    done = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", f"{env} timeout 30 liquidsoap /w/check.liq 2>&1"],
        check=False,
        capture_output=True,
        text=True,
    )
    ticks = [line for line in done.stdout.splitlines() if line.startswith("tick ")]
    with wave.open(os.path.join(work, "warmup.check.wav")) as rendered:
        samples = array("h")
        samples.frombytes(rendered.readframes(rendered.getnframes()))
    return samples, ticks


def main() -> int:
    with tempfile.TemporaryDirectory() as work:
        tone(os.path.join(work, "record.wav"), RECORD_HZ, 10.0)
        tone(os.path.join(work, "bed.wav"), BED_HZ, 30.0)
        with open(os.path.join(HERE, "warmup.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())

        # The record arrives two seconds after the lease, inside a fifteen-second allowance.
        warm, warm_ticks = run(work, push_at=3.0, warmup_s=15.0)
        # The record arrives five seconds after the lease, past a two-second allowance.
        late, late_ticks = run(work, push_at=6.0, warmup_s=2.0)

    waiting = [t for t in (1.5, 2.0, 2.5)]
    checks = [
        ("silence while the first record downloads", all(level(warm, BED_HZ, t) < 0.05 and level(warm, RECORD_HZ, t) < 0.05 for t in waiting)),
        ("the record airs once it is ready", level(warm, RECORD_HZ, 3.5) > 0.45),
        ("the bed never airs in front of it", max(level(warm, BED_HZ, t) for t in (1.2, 2.0, 2.8, 3.5, 4.5)) < 0.05),
        ("a warm-up reports no gap", not any("gap=true" in line for line in warm_ticks)),
        ("it was reported as warming meanwhile", any("warming=true" in line for line in warm_ticks)),
        ("past the allowance the bed airs", level(late, BED_HZ, 4.5) > 0.45),
        ("and that is reported as a gap", any("gap=true" in line for line in late_ticks)),
        ("the late record still airs when it arrives", level(late, RECORD_HZ, 6.6) > 0.45),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(
        f"warm: bed {max(level(warm, BED_HZ, t) for t in waiting):.2f} record {level(warm, RECORD_HZ, 3.5):.2f}  "
        f"late: bed {level(late, BED_HZ, 4.5):.2f} record {level(late, RECORD_HZ, 6.6):.2f}"
    )

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
