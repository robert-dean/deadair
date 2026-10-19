"""Airs pushed records through the WHOLE of radio.liq and counts how often the bed switches.

Every other check here runs an excerpt copied out of radio.liq. This one runs the script itself, in
the image stream/Dockerfile pins (Docker, no dev stack needed), and drives it the way the app does:
take the lease on /control/onair, push three records stamped with the hard-join blend, and keep the
lease renewed while they play. See stream/README.md.

It exists because Liquidsoap 2.4.6 took the station off air on 2026-10-19 and every excerpt passed.
From the first record on, `bed` (the fallback over the queue, the music bed and the ident) switched
between the queue and the ident on every frame, about 3,000 times a minute, and the mount skipped.
The cause needs `normalize` and `cross` and the fallback in one graph, which no excerpt had.

Three things must hold, and the third is the one 2.4.6 fails:

  aired      the status reading names the first record as on air, so the run tested something
  crossed    `cross` analysed both boundaries, so the records followed one another through it
  steady     the script logged a handful of switch lines in the whole run, not hundreds

`--image savonet/liquidsoap:vX` runs it against a candidate before the pin moves.
"""

import argparse
import json
import math
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from array import array

RATE = 44_100
HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = "check"
RECORD_S = 8.0
RECORDS = 3
# Long enough for all three records and both boundaries, with a few seconds of ident after the last.
RUN_S = RECORDS * RECORD_S + 6
# 2.4.5 logs seven switch lines across every switch in the script over this run: the boot, the gate
# opening onto the queue, and the queue running dry after the last record. 2.4.6 logged over a
# thousand. Anything past this is the bed flapping.
MAX_SWITCHES = 15


def pinned_image() -> str:
    """The image stream/Dockerfile builds on, so moving the pin is enough to make this test the new one."""
    with open(os.path.join(HERE, "Dockerfile")) as dockerfile:
        found = re.search(r"^FROM (savonet/liquidsoap:\S+)", dockerfile.read(), re.MULTILINE)
    if not found:
        sys.exit("no savonet/liquidsoap FROM line in stream/Dockerfile")
    return found.group(1)


def tone(path: str, hz: float, seconds: float) -> None:
    samples = array("h", (int(0.3 * 32767 * math.sin(2 * math.pi * hz * i / RATE)) for i in range(int(RATE * seconds))))
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(samples.tobytes())


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def control(port: int, path: str, body: str = "") -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body.encode(), headers={"X-Playout-Secret": SECRET}, method="POST")
    with urllib.request.urlopen(req, timeout=3) as res:
        return json.loads(res.read())


def status(port: int) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/control/status", headers={"X-Playout-Secret": SECRET})
    with urllib.request.urlopen(req, timeout=3) as res:
        return json.loads(res.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=pinned_image())
    image = parser.parse_args().image
    print(f"running radio.liq in {image}")

    port = free_port()
    name = f"deadair-playout-check-{port}"
    with tempfile.TemporaryDirectory() as work:
        for i, hz in enumerate([400.0, 1300.0, 2700.0][:RECORDS]):
            tone(os.path.join(work, f"r{i}.wav"), hz, RECORD_S)
        os.makedirs(os.path.join(work, "music"))
        # The defaults the container would boot on, with a secret so the control endpoints answer, an
        # empty music bed so the ident is what sits under the queue (as it did on air), nowhere for
        # the Icecast outputs to connect, and an HLS output so a sink is pulling the clock regardless.
        env = (
            "set -a; . /radio/radio.default.env; set +a; "
            f"export PLAYOUT_BRIDGE_SECRET={SECRET} ICECAST_HOST=127.0.0.1 MUSIC_DIR=/w/music "
            "STREAM_HLS_DIR=/tmp/hls LOG_FILE=/tmp/liquidsoap.log; mkdir -p /tmp/hls; "
        )
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)
        subprocess.run(
            [
                "docker", "run", "-d", "--rm", "--name", name, "--entrypoint", "sh",
                # 8005 is HARBOR_PORT in radio.default.env.
                "-p", f"127.0.0.1:{port}:8005",
                "-v", f"{HERE}:/radio:ro", "-v", f"{work}:/w", image,
                "-c", env + "exec liquidsoap /radio/radio.liq >/w/liquidsoap.log 2>&1",
            ],
            check=True,
            capture_output=True,
        )
        aired = False
        try:
            deadline = time.time() + 60
            while True:
                try:
                    control(port, "/control/onair")
                    break
                except OSError:
                    if time.time() > deadline:
                        print("FAIL  radio.liq never answered /control/onair; its log follows")
                        subprocess.run(["docker", "logs", name], check=False)
                        return 1
                    time.sleep(0.5)

            # Stamped as annotate.ts stamps a boundary the station does not blend, which is most of them.
            for i in range(RECORDS):
                control(
                    port,
                    "/control/push",
                    f'annotate:deadair_item="item{i}",liq_cross_end_duration="0.1",liq_cross_start_duration="0.1",liq_amplify="0 dB":/w/r{i}.wav',
                )

            end = time.time() + RUN_S
            while time.time() < end:
                control(port, "/control/onair")
                aired = aired or status(port).get("onAir") == "item0"
                time.sleep(1)
        finally:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)

        with open(os.path.join(work, "liquidsoap.log"), errors="replace") as log:
            lines = log.read().splitlines()

    switches = [line for line in lines if "] Switch to " in line]
    analysed = [line for line in lines if re.search(r"\[cross:\d\] Analysis:", line)]

    checks = [
        ("the first record aired", aired),
        (f"cross analysed both boundaries ({len(analysed)})", len(analysed) >= RECORDS - 1),
        (f"the script switched {len(switches)} times, at most {MAX_SWITCHES}", len(switches) <= MAX_SWITCHES),
    ]
    for label, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if len(switches) > MAX_SWITCHES:
        by_source: dict[str, int] = {}
        for line in switches:
            who = re.search(r"\[([^:\]]+):\d\] Switch", line)
            if who:
                by_source[who.group(1)] = by_source.get(who.group(1), 0) + 1
        print("switch lines by source: " + ", ".join(f"{k} {v}" for k, v in sorted(by_source.items(), key=lambda kv: -kv[1])))
        print("\n".join(switches[:6]))

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
