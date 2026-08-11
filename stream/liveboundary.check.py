"""Measures real boundaries on the live mount, from a capture of the stream itself.

The synthetic checks beside this one use tones at non-harmonic frequencies so each
record's envelope can be read off its own bin. Real records do not cooperate. An earlier
version of this tried to unmix each frame against spectral templates taken from either
side; it does not work, because two broadband rock records resemble each other's
templates about as much as their own, and it reported a 23s "transition" between two
records that had cut straight from one to the other.

So this measures two things that need no template and no model of the music:

    level      the loudness envelope across the join. A blend holds level; a hard cut
               holds it too; a GAP does not. This is the one that catches dead air, and
               it is the one that caught a second of near-silence at every boundary.
    sharpness  frame-to-frame spectral change at the join, against the same quantity
               everywhere else in the record. A hard cut is one enormous outlier: the
               spectrum is wholly one record and then wholly another inside 20ms. A
               crossfade has no such instant, however different the two records are.

Neither says how LONG a blend is. For that, use the synthetic checks, which can.

Capture with a listener connected -- the connection is what holds the audience gate
open -- and log nowplaying alongside, so boundaries are located by what the station says
aired rather than guessed from the audio:

    date +%s.%N > start.txt
    ffmpeg -v error -i http://localhost:8000/live.mp3 -t 430 -ac 1 -ar 22050 -y live.wav &
    while :; do printf '%s ' "$(date +%s.%N)"; curl -s localhost:3333/nowplaying; echo; sleep 2; done > now.log

Usage: python3 stream/liveboundary.check.py <capture.wav> <nowplaying.log> <start.txt>
"""

import json
import subprocess
import sys

import numpy as np

RATE = 22_050
WIN = 2048
HOP = 512
PER_FRAME = HOP / RATE

# Below this, against the record either side, the join has a hole in it a listener hears
# as the station stopping. Not an absolute level: records differ, so it is measured as a
# drop from the quieter of the two neighbouring passages.
DIP_DB = 20.0
SEARCH_S = 6.0


def decode(path: str) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4")


def spectrogram(x: np.ndarray) -> np.ndarray:
    frames = (len(x) - WIN) // HOP + 1
    window = np.hanning(WIN)
    spec = np.array([np.abs(np.fft.rfft(x[i * HOP : i * HOP + WIN] * window)) for i in range(frames)])
    return spec / (np.linalg.norm(spec, axis=1, keepdims=True) + 1e-12)


def level_db(x: np.ndarray) -> np.ndarray:
    """Loudness over time, on the spectrogram's own frame grid."""
    frames = (len(x) - WIN) // HOP + 1
    rms = np.array([np.sqrt(float((x[i * HOP : i * HOP + WIN].astype(np.float64) ** 2).mean())) for i in range(frames)])
    return 20 * np.log10(np.maximum(rms, 1e-9))


def flux(spec: np.ndarray) -> np.ndarray:
    """Frame-to-frame spectral change. One value per frame, first frame zero."""
    d = 1.0 - np.sum(spec[1:] * spec[:-1], axis=1)
    return np.concatenate([[0.0], d])


def timeline(log: str, started: float) -> list[tuple[float, str, bool]]:
    out: list[tuple[float, str, bool]] = []
    for line in open(log, encoding="utf-8"):
        ts, _, body = line.partition(" ")
        try:
            data = json.loads(body)
        except Exception:
            continue
        track = data.get("track") or {}
        title, artist = track.get("title") or "-", track.get("artist") or ""
        label = f"{artist} — {title}" if artist else title
        # A segment airs with no artist. A boundary touching one is a hard join by design.
        if not out or out[-1][1] != label:
            out.append((float(ts) - started, label, bool(artist)))
    return out


def main(wav: str, log: str, started_file: str) -> int:
    x = decode(wav)
    started = float(open(started_file, encoding="utf-8").read().strip())
    spec = spectrogram(x)
    lvl = level_db(x)
    flx = flux(spec)
    typical = float(np.median(flx)), float(np.percentile(flx, 99))

    print(f"captured {len(x) / RATE:.1f}s of the live mount")
    print(f"frame-to-frame spectral change over the whole capture: median {typical[0]:.3f}, 99th pct {typical[1]:.3f}\n")

    failures = 0
    for i in range(1, len(timeline(log, started))):
        events = timeline(log, started)
        _, out_label, out_rec = events[i - 1]
        when, in_label, in_rec = events[i]
        pair = "record -> record" if (out_rec and in_rec) else "involves a segment"

        # Locate the join by the biggest spectral jump near where nowplaying put it.
        guess = int(when / PER_FRAME)
        span = int(SEARCH_S / PER_FRAME)
        lo, hi = max(1, guess - span), min(len(flx), guess + span)
        if hi <= lo:
            continue
        at = int(lo + np.argmax(flx[lo:hi]))

        # Level of the settled music either side, and the worst moment between them.
        before = float(np.median(lvl[max(0, at - int(6 / PER_FRAME)) : max(1, at - int(2 / PER_FRAME))]))
        after = float(np.median(lvl[at + int(2 / PER_FRAME) : at + int(6 / PER_FRAME)]))
        window = lvl[max(0, at - int(2 / PER_FRAME)) : at + int(2 / PER_FRAME)]
        worst = float(window.min()) if window.size else 0.0
        dip = min(before, after) - worst
        held = float(np.sum(window < min(before, after) - DIP_DB)) * PER_FRAME

        sharp = float(flx[at])
        print(f"{at * PER_FRAME:7.2f}s  {out_label}\n           -> {in_label}   [{pair}]")
        print(f"           level {before:6.1f} dBFS before, {after:6.1f} after, worst {worst:6.1f} in between")
        if dip > DIP_DB:
            print(f"           DIP of {dip:.0f} dB, {held:.2f}s below the music either side -- audible dead air")
            failures += 1
        else:
            print(f"           level held across the join (worst dip {dip:.0f} dB)")
        verdict = "one instant -- a HARD CUT" if sharp > typical[1] else "spread out -- consistent with a blend"
        print(f"           spectral change at the join {sharp:.3f} vs 99th pct {typical[1]:.3f}: {verdict}\n")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
