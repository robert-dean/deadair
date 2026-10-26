"""Puts a live encoder on the air through the WHOLE of radio.liq, and checks it only goes there when it should.

Runs the script itself in the image stream/Dockerfile pins (Docker, no dev stack needed), with one line
appended to the copy it runs: an `output.file` on `bus`, so what the mount would carry can be measured.
The station is driven the way the app drives it: the lease taken and renewed every second, and one long
record pushed (a 400 Hz tone). A second container from the same image plays the presenter, pushing to
the `live` mount on LIVE_PORT with `output.icecast`: a 1300 Hz tone, or silence, or a tone that falls
silent after a while. See "Live input" in stream/README.md.

What must hold, in order:

  unarmed       an encoder connected and sending signal changes nothing: the state stays off
  silent        armed, an encoder sending only silence never starts the countdown
  preroll       armed, real signal starts the countdown, reported with its time left falling,
                and the input goes on air about LIVE_PREROLL_S later
  drop          a presenter gone quiet is handed back after LIVE_DROP_S
  disconnect    so is one whose encoder went away
  disarm        and a disarm hands back at once
  audio         the presenter's tone reaches the bus only while on air, and the record is back after
                every hand-back

`--image savonet/liquidsoap:vX` runs it against a candidate before the pin moves.
"""

import argparse
import json
import math
import os
import re
import shutil
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
PASSWORD = "livecheck"
PROGRAMME_HZ = 400.0
LIVE_HZ = 1300.0
RECORD_S = 150.0
# radio.default.env's own values, which this asserts against.
SIGNAL_S = 0.5
# The input's buffer in radio.liq: an encoder that goes away is still heard for this long, so a
# drop is measured from when what it sent runs out, not from the disconnect.
BUFFER_S = 2.0
PREROLL_S = 3.0
DROP_S = 8.0


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


def control(port: int, path: str, body: str = "", headers: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=body.encode(), headers={"X-Playout-Secret": SECRET, **(headers or {})}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=3) as res:
        return json.loads(res.read())


def status(port: int) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/control/status", headers={"X-Playout-Secret": SECRET})
    with urllib.request.urlopen(req, timeout=3) as res:
        return json.loads(res.read())


# The presenter: a tone for TONE_S seconds and silence after it, so 0 is an encoder sending nothing
# and a large number is one that never stops. `output.icecast` is what BUTT and Mixxx speak.
PRESENTER = """
on = ref(true)
tone_s = float_of_string(environment.get("TONE_S", default="0"))
if tone_s <= 0. then on := false end
thread.run(delay=max(0.1, tone_s), fun () -> on := false)
s = fallback(track_sensitive=false, [switch(track_sensitive=false, [({on()}, sine(amplitude=0.3, %s))]), blank()])
output.icecast(%%mp3, host=environment.get("STATION"), port=8006, password=environment.get("PASSWORD"), mount="live", s)
""" % LIVE_HZ


def level(samples: array, hz: float, at: float, span: float = 0.2) -> float:
    """Amplitude of one frequency over a short window, by correlation, so the two tones separate."""
    start, end = int(at * RATE), int((at + span) * RATE)
    window = samples[start:end]
    if len(window) == 0:
        return 0.0
    re_ = sum(x * math.cos(2 * math.pi * hz * (start + i) / RATE) for i, x in enumerate(window))
    im = sum(x * math.sin(2 * math.pi * hz * (start + i) / RATE) for i, x in enumerate(window))
    return 2 * math.hypot(re_, im) / len(window) / 32767


def read_pcm(path: str) -> array:
    """The left channel after the `data` chunk header, whatever the header claims: a stopped container
    may not have gone back to fill in the length."""
    with open(path, "rb") as f:
        raw = f.read()
    at = raw.find(b"data")
    samples = array("h")
    body = raw[at + 8 :]
    samples.frombytes(body[: len(body) - len(body) % 4])
    # The bus is stereo; the left channel is enough to tell the two tones apart.
    return samples[0::2]


class Run:
    def __init__(self, image: str, work: str, port: int):
        self.image, self.work, self.port = image, work, port
        self.net = f"deadair-live-check-{port}"
        self.station = f"deadair-live-station-{port}"
        self.presenter = f"deadair-live-presenter-{port}"
        self.events: list[tuple[float, str]] = []
        self.t0 = 0.0

    def note(self, what: str) -> None:
        self.events.append((time.time(), what))

    def start_station(self) -> None:
        env = (
            "set -a; . /radio/radio.default.env; set +a; "
            f"export PLAYOUT_BRIDGE_SECRET={SECRET} HARBOR_PASSWORD={PASSWORD} ICECAST_HOST=127.0.0.1 MUSIC_DIR=/w/music "
            "STREAM_HLS_DIR=/tmp/hls LOG_FILE=/tmp/liquidsoap.log; mkdir -p /tmp/hls; "
        )
        subprocess.run(["docker", "network", "create", self.net], capture_output=True, check=False)
        subprocess.run(
            [
                "docker", "run", "-d", "--rm", "--name", self.station, "--network", self.net, "--entrypoint", "sh",
                # 8005 is HARBOR_PORT in radio.default.env.
                "-p", f"127.0.0.1:{self.port}:8005",
                "-v", f"{HERE}:/radio:ro", "-v", f"{self.work}:/w", self.image,
                "-c", env + "exec liquidsoap /w/radio.liq >/w/liquidsoap.log 2>&1",
            ],
            check=True,
            capture_output=True,
        )

    def presenter_on(self, tone_s: float) -> None:
        self.presenter_off()
        subprocess.run(
            [
                "docker", "run", "-d", "--rm", "--name", self.presenter, "--network", self.net, "--entrypoint", "sh",
                "-v", f"{self.work}:/w", "-e", f"STATION={self.station}", "-e", f"PASSWORD={PASSWORD}", "-e", f"TONE_S={tone_s}",
                self.image, "-c", "exec liquidsoap /w/presenter.liq >/w/presenter.log 2>&1",
            ],
            check=True,
            capture_output=True,
        )
        self.note(f"presenter on (tone {tone_s}s)")

    def presenter_off(self) -> None:
        if subprocess.run(["docker", "rm", "-f", self.presenter], capture_output=True, check=False).stdout.strip():
            self.note("presenter off")

    def stop(self) -> None:
        self.presenter_off()
        subprocess.run(["docker", "stop", "-t", "5", self.station], capture_output=True, check=False)
        subprocess.run(["docker", "network", "rm", self.net], capture_output=True, check=False)

    def hold(self, seconds: float, until=None) -> tuple[list[tuple[float, dict]], bool]:
        """Renew the lease every half second for up to `seconds`, keeping every reading taken. Stops
        early when `until(reading)` holds, and says whether it did."""
        readings: list[tuple[float, dict]] = []
        end = time.time() + seconds
        last_renew = 0.0
        while time.time() < end:
            if time.time() - last_renew >= 1.0:
                control(self.port, "/control/onair")
                last_renew = time.time()
            reading = status(self.port)
            readings.append((time.time(), reading))
            if until and until(reading):
                return readings, True
            time.sleep(0.1)
        return readings, False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=pinned_image())
    image = parser.parse_args().image
    print(f"running radio.liq with a live encoder in {image}")

    port = free_port()
    checks: list[tuple[str, bool]] = []
    with tempfile.TemporaryDirectory() as work:
        tone(os.path.join(work, "record.wav"), PROGRAMME_HZ, RECORD_S)
        os.makedirs(os.path.join(work, "music"))
        with open(os.path.join(HERE, "radio.liq")) as src, open(os.path.join(work, "radio.liq"), "w") as dst:
            dst.write(src.read())
            dst.write('\n# ── HARNESS, not in radio.liq ──\noutput.file(%wav, "/w/aired.wav", bus)\n')
        with open(os.path.join(work, "presenter.liq"), "w") as f:
            f.write(PRESENTER)

        run = Run(image, work, port)
        run.start_station()
        on_air_spans: list[tuple[float, float]] = []
        back_at: list[float] = []
        try:
            deadline = time.time() + 60
            while True:
                try:
                    control(port, "/control/onair")
                    break
                except OSError:
                    if time.time() > deadline:
                        print("FAIL  radio.liq never answered /control/onair; its log follows")
                        subprocess.run(["docker", "logs", run.station], check=False)
                        return 1
                    time.sleep(0.5)

            control(port, "/control/push", f'annotate:deadair_item="record",liq_amplify="0 dB":/w/record.wav')
            run.t0 = time.time()
            run.hold(3)

            # unarmed: a connected encoder with signal changes nothing.
            run.presenter_on(1000)
            readings, _ = run.hold(7)
            checks.append(("unarmed: an encoder with signal leaves the state off", all(r["live"] == "off" for _, r in readings)))
            run.presenter_off()
            # Let what it sent drain out of the input's buffer, or arming would hear the tail of it.
            run.hold(BUFFER_S + 2)

            # silent: armed, but nothing to hear.
            armed = control(port, "/control/live/arm", "Live check")
            checks.append(("arm answers the reading with live armed", armed.get("live") == "armed"))
            run.presenter_on(0)
            readings, _ = run.hold(6)
            checks.append(("silent: armed with silence never starts the countdown", all(r["live"] == "armed" for _, r in readings)))
            run.presenter_off()

            # preroll, then drop: a tone for 12s, then silence.
            run.presenter_on(12)
            readings, got = run.hold(15, until=lambda r: r["live"] == "onair")
            prerolls = [(t, r["liveInMs"]) for t, r in readings if r["live"] == "preroll"]
            falling = len(prerolls) >= 2 and prerolls[-1][1] < prerolls[0][1] and all(0 <= ms <= PREROLL_S * 1000 for _, ms in prerolls)
            checks.append(("preroll: real signal starts a countdown with its time left falling", falling))
            on_at = readings[-1][0]
            countdown = on_at - prerolls[0][0] if prerolls else -1
            checks.append((f"preroll: on air {countdown:.1f}s after the countdown began (about {PREROLL_S})", got and PREROLL_S - 0.6 <= countdown <= PREROLL_S + 0.8))
            readings, got = run.hold(30, until=lambda r: r["live"] == "off")
            off_at = readings[-1][0]
            longest = max((r["liveForMs"] for _, r in readings), default=-1)
            on_air_spans.append((on_at, off_at))
            back_at.append(off_at)
            # The presenter's tone stops 12s after its own start, which is a container boot after it was
            # started here. Where it started is read back off the countdown instead: signal was heard
            # SIGNAL_S (plus the meter's 0.4s window) before the countdown began.
            tone_from = prerolls[0][0] - SIGNAL_S - 0.4 if prerolls else on_at
            quiet_for = off_at - (tone_from + 12)
            checks.append((f"drop: handed back {quiet_for:.1f}s after the presenter fell silent (about {DROP_S})", got and DROP_S - 1.5 <= quiet_for <= DROP_S + 2.0))
            checks.append(("on air, liveForMs counts up", longest > 3000))
            run.presenter_off()

            # disconnect: on air, then the encoder goes away.
            control(port, "/control/live/arm")
            run.presenter_on(1000)
            readings, got = run.hold(15, until=lambda r: r["live"] == "onair")
            on_at = readings[-1][0]
            run.hold(3)
            run.presenter_off()
            gone_at = run.events[-1][0]
            readings, got = run.hold(20, until=lambda r: r["live"] == "off")
            off_at = readings[-1][0]
            on_air_spans.append((on_at, gone_at))
            # Once the buffer has drained, the input is no longer ready and what is underneath plays,
            # inside the drop window and before the hand-back: that is the measurement here.
            back_at.append(gone_at + BUFFER_S + 1.5)
            checks.append(
                (
                    f"disconnect: handed back {off_at - gone_at:.1f}s after the encoder went (about {DROP_S} after its buffer of {BUFFER_S})",
                    got and DROP_S - 1.0 <= off_at - gone_at <= DROP_S + BUFFER_S + 1.5,
                )
            )

            # disarm: on air, then handed back by the app.
            control(port, "/control/live/arm")
            run.presenter_on(1000)
            readings, got = run.hold(15, until=lambda r: r["live"] == "onair")
            on_at = readings[-1][0]
            run.hold(3)
            disarmed = control(port, "/control/live/disarm")
            off_at = time.time()
            on_air_spans.append((on_at, off_at))
            back_at.append(off_at)
            checks.append(("disarm: an immediate hand-back", disarmed.get("live") == "off" and disarmed.get("liveForMs") == -1))
            run.hold(3)
        finally:
            run.stop()

        shutil.copy(os.path.join(work, "liquidsoap.log"), os.path.join(tempfile.gettempdir(), "live.check.liquidsoap.log"))
        samples = read_pcm(os.path.join(work, "aired.wav"))

    # Where wall-clock time sits in the file: the record starts the moment it was pushed (the lease was
    # already held, and a local file resolves at once), so its first loud window anchors the two.
    step = 0.1
    onset = next((i * step for i in range(int(len(samples) / RATE / step)) if level(samples, PROGRAMME_HZ, i * step, 0.1) > 0.1), None)
    if onset is None:
        print("FAIL  the record never reached the bus, so nothing below can be measured")
        return 1

    def at(wall: float) -> float:
        return onset + (wall - run.t0)

    def live_loud(wall: float) -> bool:
        return level(samples, LIVE_HZ, at(wall)) > 0.05

    def programme_loud(wall: float) -> bool:
        return level(samples, PROGRAMME_HZ, at(wall)) > 0.05

    first_on = on_air_spans[0][0]
    before = [run.t0 + 1 + i * 0.5 for i in range(int((first_on - run.t0 - 2) / 0.5))]
    checks.append(("audio: no live tone on the bus before the first time on air (unarmed, silent, the countdown)", not any(live_loud(w) for w in before)))
    checks.append(("audio: the record plays through all of that", all(programme_loud(w) for w in before)))
    for n, (start, end) in enumerate(on_air_spans, 1):
        middle = start + 1.0
        checks.append((f"audio: on air {n}, the presenter is on the bus and the record is not", live_loud(middle) and not programme_loud(middle)))
    # The first span's tone had already stopped before the hand-back, so only the record is checked
    # after it. The second is checked inside the drop window, once the dropped connection's buffer
    # has run out: what is underneath plays there, before any hand-back.
    for n, back in enumerate(back_at, 1):
        checks.append((f"audio: the record is back after hand-back {n}", programme_loud(back + 1.0)))

    for label, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not all(ok for _, ok in checks):
        print("timeline: " + "; ".join(f"{t - run.t0:.1f}s {what}" for t, what in run.events))
        print(f"the station's log is at {os.path.join(tempfile.gettempdir(), 'live.check.liquidsoap.log')}")
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
