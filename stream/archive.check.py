"""Records the station through the WHOLE of radio.liq, and checks the archive keeps what aired and nothing else.

Runs the script itself in the image stream/Dockerfile pins, twice: once with ARCHIVE_MODE=all and once with
`live`, both with the hourly slot shortened to the minute (ARCHIVE_SLOT) so a cut can be watched. The station
is driven the way the app drives it, and a second container plays the presenter, both borrowed from
live.check.py. See "The archive" in stream/README.md.

What must hold:

  no lease      nothing is written while the station is off the air
  lease         under `all`, holding the air opens an hourly file
  live          a live show is its own file, titled, and the hourly one is closed for it
  hand-back     the show's file is closed, and the hourly one starts again
  slot          a new hourly file begins when the slot moves on
  stand-down    a lapsed lease closes the file and opens no other
  live only     under `live`, the programme is never written and the show still is
  sidecars      every file has a sidecar with its kind and when it began, and a closed one when it ended
  hls           the HLS output still comes up beside it

`--image savonet/liquidsoap:vX` runs it against a candidate before the pin moves.
"""

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TITLE = "Archive check"

# The driving and the presenter are live.check.py's, so the two harnesses cannot drift apart on how
# the station is pushed or how an encoder connects.
_spec = importlib.util.spec_from_file_location("live_check", os.path.join(HERE, "live.check.py"))
live = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(live)


class ArchiveRun(live.Run):
    def __init__(self, image: str, work: str, port: int, mode: str):
        super().__init__(image, work, port)
        self.mode = mode

    def start_station(self) -> None:
        env = (
            "set -a; . /radio/radio.default.env; set +a; "
            f"export PLAYOUT_BRIDGE_SECRET={live.SECRET} HARBOR_PASSWORD={live.PASSWORD} ICECAST_HOST=127.0.0.1 MUSIC_DIR=/w/music "
            f"STREAM_HLS_DIR=/w/hls LOG_FILE=/tmp/liquidsoap.log ARCHIVE_DIR=/w/archive ARCHIVE_MODE={self.mode} "
            "ARCHIVE_SLOT='%Y-%m-%d %H:%M'; mkdir -p /w/hls; "
        )
        subprocess.run(["docker", "network", "create", self.net], capture_output=True, check=False)
        subprocess.run(
            [
                "docker", "run", "-d", "--rm", "--name", self.station, "--network", self.net, "--entrypoint", "sh",
                "-p", f"127.0.0.1:{self.port}:8005",
                "-v", f"{HERE}:/radio:ro", "-v", f"{self.work}:/w", self.image,
                "-c", env + "exec liquidsoap /w/radio.liq >/w/liquidsoap.log 2>&1",
            ],
            check=True,
            capture_output=True,
        )

    def wait_up(self) -> bool:
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                live.status(self.port)
                return True
            except OSError:
                time.sleep(0.5)
        return False

    def wait(self, seconds: float) -> None:
        """Wait WITHOUT renewing the lease."""
        time.sleep(seconds)


def recordings(work: str) -> list[dict]:
    """Every MP3 under the archive, oldest first, with its sidecar (or None) and its size."""
    root = os.path.join(work, "archive")
    found = []
    for day in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        for name in sorted(os.listdir(os.path.join(root, day))):
            if not name.endswith(".mp3"):
                continue
            path = os.path.join(root, day, name)
            side = path[: -len(".mp3")] + ".json"
            meta = None
            if os.path.exists(side):
                with open(side) as f:
                    meta = json.load(f)
            found.append({"name": f"{day}/{name}", "size": os.path.getsize(path), "meta": meta})
    return found


def kinds(found: list[dict]) -> list[str]:
    return [r["meta"]["kind"] if r["meta"] else "?" for r in found]


def go_live(run: ArchiveRun) -> bool:
    live.control(run.port, "/control/live/arm", TITLE)
    run.presenter_on(1000)
    _, got = run.hold(20, until=lambda r: r["live"] == "onair")
    return got


def run_all(image: str, checks: list[tuple[str, bool]]) -> None:
    with tempfile.TemporaryDirectory() as work:
        prepare(work)
        run = ArchiveRun(image, work, live.free_port(), "all")
        run.start_station()
        try:
            if not run.wait_up():
                checks.append(("all: radio.liq answered", False))
                subprocess.run(["docker", "logs", run.station], check=False)
                return

            run.wait(4)
            checks.append(("no lease: nothing is written off the air", recordings(work) == []))

            live.control(run.port, "/control/onair")
            live.control(run.port, "/control/push", 'annotate:deadair_item="record",liq_amplify="0 dB":/w/record.wav')
            run.hold(5)
            found = recordings(work)
            checks.append(("lease: holding the air opens one hourly file", kinds(found) == ["hour"]))

            on = go_live(run)
            run.hold(4)
            found = recordings(work)
            show = [r for r in found if r["meta"] and r["meta"]["kind"] == "live"]
            checks.append(("live: the show went on air", on))
            checks.append(("live: the show is its own file, titled", len(show) == 1 and show[0]["meta"]["title"] == TITLE))
            checks.append(("live: the hourly file was closed for it", bool(found) and found[0]["meta"].get("endedAtMs", 0) > 0))

            live.control(run.port, "/control/live/disarm")
            run.presenter_off()
            run.hold(3)
            found = recordings(work)
            show = [r for r in found if r["meta"] and r["meta"]["kind"] == "live"]
            checks.append(("hand-back: the show's file is closed", len(show) == 1 and show[0]["meta"].get("endedAtMs", 0) > 0))
            checks.append(("hand-back: an hourly file starts again", kinds(found) == ["hour", "live", "hour"]))
            # 192 kbps is 24 kB a second; four seconds of show is well over 50 kB.
            checks.append(("live: the show's file holds audio", len(show) == 1 and show[0]["size"] > 50_000))

            # Hold across the next minute boundary, which is the slot this run was given.
            boundary = 60 - time.localtime().tm_sec
            run.hold(boundary + 3)
            found = recordings(work)
            checks.append(("slot: a new hourly file begins when the slot moves on", kinds(found) == ["hour", "live", "hour", "hour"]))

            live.control(run.port, "/control/offair")
            run.wait(3)
            before = recordings(work)
            run.wait(4)
            after = recordings(work)
            checks.append(("stand-down: the last file is closed", bool(before) and before[-1]["meta"].get("endedAtMs", 0) > 0))
            checks.append(("stand-down: and no other opens", len(after) == len(before)))
            checks.append(("hls: the HLS output still comes up beside the archive", os.path.exists(os.path.join(work, "hls", "live.m3u8"))))
        finally:
            run.stop()

        found = recordings(work)
        complete = all(r["meta"] and r["meta"]["startedAtMs"] > 0 and r["meta"].get("endedAtMs", 0) >= r["meta"]["startedAtMs"] for r in found)
        checks.append(("sidecars: every file has one, with when it began and ended", bool(found) and complete))
        if not all(ok for _, ok in checks):
            print("all: " + "; ".join(f"{r['name']} {r['size']}B {r['meta']}" for r in found))
            keep_log(work, "all")


def run_live_only(image: str, checks: list[tuple[str, bool]]) -> None:
    with tempfile.TemporaryDirectory() as work:
        prepare(work)
        run = ArchiveRun(image, work, live.free_port(), "live")
        run.start_station()
        try:
            if not run.wait_up():
                checks.append(("live only: radio.liq answered", False))
                subprocess.run(["docker", "logs", run.station], check=False)
                return
            live.control(run.port, "/control/onair")
            live.control(run.port, "/control/push", 'annotate:deadair_item="record",liq_amplify="0 dB":/w/record.wav')
            run.hold(5)
            checks.append(("live only: the programme is never written", recordings(work) == []))
            go_live(run)
            run.hold(3)
            live.control(run.port, "/control/live/disarm")
            run.presenter_off()
            run.hold(3)
            found = recordings(work)
            checks.append(("live only: the show still is, and closed", kinds(found) == ["live"] and found[0]["meta"].get("endedAtMs", 0) > 0))
        finally:
            run.stop()
        if not all(ok for _, ok in checks):
            keep_log(work, "live")


def prepare(work: str) -> None:
    live.tone(os.path.join(work, "record.wav"), live.PROGRAMME_HZ, live.RECORD_S)
    os.makedirs(os.path.join(work, "music"))
    with open(os.path.join(HERE, "radio.liq")) as src, open(os.path.join(work, "radio.liq"), "w") as dst:
        dst.write(src.read())
    with open(os.path.join(work, "presenter.liq"), "w") as f:
        f.write(live.PRESENTER)


def keep_log(work: str, label: str) -> None:
    kept = os.path.join(tempfile.gettempdir(), f"archive.check.{label}.liquidsoap.log")
    subprocess.run(["cp", os.path.join(work, "liquidsoap.log"), kept], check=False)
    print(f"the station's log ({label}) is at {kept}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=live.pinned_image())
    image = parser.parse_args().image
    print(f"running radio.liq with the archive on in {image}")

    checks: list[tuple[str, bool]] = []
    run_all(image, checks)
    run_live_only(image, checks)
    for label, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
