"""Measures where the voice leaves the compressor, from what `voice.check.liq` rendered.

Levels speech to an aim the way the app's stamp does, runs the shared voice compressor in the pinned
Liquidsoap image (Docker, no dev stack needed) at two aims, and reads the loudness back to BS.1770.
See stream/README.md.

The speech is synthesised by default: voiced syllables, pauses between words and sentences, and a
plosive burst at the start of most words, which is the crest a speech engine produces. Pass
`--segment FILE` to measure a real one instead, such as a break downloaded from your own station
(GET /api/segments/{id}/audio). The makeup in radio.liq was measured that way, on two of them.
"""

import argparse
import math
import os
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from array import array

RATE = 22_050
IMAGE = "savonet/liquidsoap:v2.4.5"
HERE = os.path.dirname(os.path.abspath(__file__))
AIMS = (-13.0, -18.0)


def write_wav(path: str, samples: list) -> None:
    peak = max(abs(v) for v in samples) or 1.0
    scale = 0.5 / peak
    with wave.open(path, "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<hh", int(v * scale * 32767), int(v * scale * 32767)) for v in samples))


def synthetic_speech(seconds: float = 20.0) -> list:
    """Syllables on a gliding fundamental, with the gaps and plosives that give speech its crest."""
    rng = random.Random(7)
    out = []
    while len(out) < seconds * RATE:
        for _ in range(rng.randint(4, 9)):  # a sentence
            # a plosive at the start of most words: a few milliseconds of broadband noise, hot
            if rng.random() < 0.7:
                out.extend(rng.uniform(-1, 1) * 2.5 * (1 - i / 120) for i in range(120))
            for _ in range(rng.randint(1, 3)):  # a word
                f0 = rng.uniform(110, 170)
                n = int(rng.uniform(0.12, 0.24) * RATE)
                for i in range(n):
                    env = math.sin(math.pi * i / n) ** 0.6
                    f = f0 * (1 + 0.08 * i / n)
                    out.append(env * sum(math.sin(2 * math.pi * k * f * i / RATE) / k for k in range(1, 12)))
                out.extend([0.0] * int(0.05 * RATE))
            out.extend([0.0] * int(rng.uniform(0.12, 0.25) * RATE))
        out.extend([0.0] * int(rng.uniform(0.4, 0.7) * RATE))
    return out


def read_stereo(path: str) -> tuple:
    # Frames from the file size, not the header: a render stopped by `shutdown` never finalises it.
    with wave.open(path) as w:
        frames = (os.path.getsize(path) - 44) // 4
        raw = array("h")
        raw.frombytes(w.readframes(frames))
    return [v / 32768 for v in raw[0::2]], [v / 32768 for v in raw[1::2]]


def biquads(fs: float) -> list:
    A = 10 ** (4 / 40)
    w0 = 2 * math.pi * 1500 / fs
    c, al, sA = math.cos(w0), math.sin(w0) / math.sqrt(2), math.sqrt(A)
    shelf = (A * ((A + 1) + (A - 1) * c + 2 * sA * al), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - 2 * sA * al),
             (A + 1) - (A - 1) * c + 2 * sA * al, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * sA * al)
    w0 = 2 * math.pi * 38 / fs
    c, al = math.cos(w0), math.sin(w0)
    highpass = ((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al)
    return [tuple(x / q[3] for x in q) for q in (shelf, highpass)]


def k_weighted(x: list) -> list:
    for b0, b1, b2, _, a1, a2 in biquads(RATE):
        y, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
        for v in x:
            o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, v, y1, o
            y.append(o)
        x = y
    return x


def loudness(path: str) -> tuple:
    """Gated integrated loudness (BS.1770) and sample peak, both in dB."""
    left, right = read_stereo(path)
    peak = 20 * math.log10(max(max(map(abs, left)), max(map(abs, right))) + 1e-9)
    kl, kr = k_weighted(left), k_weighted(right)
    block, hop = int(0.4 * RATE), int(0.1 * RATE)
    blocks = [(sum(v * v for v in kl[s : s + block]) + sum(v * v for v in kr[s : s + block])) / block for s in range(0, len(kl) - block, hop)]
    lufs = lambda z: -0.691 + 10 * math.log10(z + 1e-12)
    gated = [z for z in blocks if lufs(z) > -70]
    relative = lufs(sum(gated) / len(gated)) - 10
    gated = [z for z in gated if lufs(z) > relative]
    return lufs(sum(gated) / len(gated)), peak


def run(work: str, aim: float, stamp_db: float) -> None:
    subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", "-e", f"AIM={aim}", "-e", f"STAMP_DB={stamp_db}", "-v", f"{work}:/w", IMAGE, "-c",
         "timeout 60 liquidsoap /w/check.liq >/dev/null 2>&1"],
        check=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--segment", help="a real segment to measure instead of synthetic speech")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as work:
        shutil.copy(os.path.join(HERE, "voice.check.liq"), os.path.join(work, "check.liq"))
        if args.segment:
            # Decoded by the same image, so this needs nothing on the host but Docker.
            shutil.copy(args.segment, os.path.join(work, "segment"))
            decode = 'settings.init.allow_root := true\nsettings.frame.audio.samplerate := 22050\n' \
                     'o = output.file(%wav(stereo), fallible=true, "/w/speech.wav", once(single("/w/segment")))\n' \
                     'c = clock.create(sync="none")\nc.unify(o.clock)\nthread.run(delay=30., fun () -> shutdown())\n'
            open(os.path.join(work, "decode.liq"), "w").write(decode)
            subprocess.run(["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{work}:/w", IMAGE, "-c", "timeout 60 liquidsoap /w/decode.liq >/dev/null 2>&1"], check=False)
        else:
            write_wav(os.path.join(work, "speech.wav"), synthetic_speech())

        raw, _ = loudness(os.path.join(work, "speech.wav"))
        print(f"speech as given: {raw:.1f} LUFS ({'--segment ' + args.segment if args.segment else 'synthetic'})")

        results = {}
        for aim in AIMS:
            run(work, aim, aim - raw)
            results[aim] = (loudness(os.path.join(work, "chain.wav")), loudness(os.path.join(work, "fixed.wav")))
            (out, peak), (fixed, _) = results[aim]
            print(f"aim {aim:5.1f}  leaves at {out:6.1f} LUFS ({out - aim:+.1f})  peak {peak:+5.1f} dBFS   fixed -18 threshold: {fixed:6.1f} LUFS ({fixed - aim:+.1f})")

    errors = [results[aim][0][0] - aim for aim in AIMS]
    checks = [
        # The whole point: the voice leaves where the app aimed it, so the duck and the records either
        # side meet the level they were designed against. Within a decibel and a half, because the
        # makeup was measured on one engine's speech and another's crest moves it a little.
        ("the voice leaves within 1.5 dB of its aim", all(abs(e) < 1.5 for e in errors)),
        # And the same distance from it whatever the aim, which is what the threshold following the
        # aim buys. The fixed threshold this replaced fails this by most of the difference in aims.
        ("the compressor does the same at every aim", abs(errors[0] - errors[1]) < 0.3),
    ]
    for name, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")

    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
