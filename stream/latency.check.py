"""Checks what the streaming clock does with a stall, from what `latency.check.liq` printed.

Runs the harness twice in the pinned Liquidsoap image (Docker, no dev stack needed): once with the
cap `radio.liq` sets on how far the clock may fall behind, once with Liquidsoap's own sixty seconds.
Reads how much audio the source had produced against how much wall time had passed. See
stream/README.md.
"""

import os
import re
import subprocess
import sys
import tempfile

IMAGE = "savonet/liquidsoap:v2.4.5"
HERE = os.path.dirname(os.path.abspath(__file__))
STALL_S = 20.0


def run(work: str, cap: str | None) -> tuple[float, float, bool]:
    env = f"CLOCK_MAX_LATENCY_S={cap} " if cap is not None else ""
    done = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", f"{env}timeout 90 liquidsoap /w/check.liq 2>&1"],
        check=False,
        capture_output=True,
        text=True,
    )
    found = re.search(r"produced ([0-9.]+) wall ([0-9.]+)", done.stdout)
    if not found:
        print(done.stdout[-2000:])
        raise SystemExit("the harness printed no reading")
    return float(found.group(1)), float(found.group(2)), "Too much latency" in done.stdout


def main() -> int:
    with tempfile.TemporaryDirectory() as work:
        with open(os.path.join(HERE, "latency.check.liq")) as source, open(os.path.join(work, "check.liq"), "w") as copy:
            copy.write(source.read())
        capped, capped_wall, capped_reset = run(work, None)
        burst, burst_wall, burst_reset = run(work, "60")

    capped_behind = capped_wall - capped
    burst_behind = burst_wall - burst
    checks = [
        ("with the cap, the clock resets", capped_reset),
        ("and the stall is dropped rather than produced", abs(capped_behind - STALL_S) < 3.0),
        ("at sixty seconds there is no reset", not burst_reset),
        ("and the whole stall is produced afterwards (the burst)", abs(burst_behind) < 2.0),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"capped: {capped:.1f}s of audio in {capped_wall:.1f}s  uncapped: {burst:.1f}s of audio in {burst_wall:.1f}s")
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
