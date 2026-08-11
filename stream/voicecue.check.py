"""Measures where a DJ break actually landed, from what `voicecue.check.liq` rendered.

The question is whether `on_air_cross_lag` in radio.liq is a correction or an error. The
record under test has a 4s blend in and an 8s blend out, and the correction uses the
latter, so the three candidate answers are far enough apart to be unambiguous:

    6s   the correction is right
   14s   the true lag is zero and the correction is pure error
   10s   the true lag is the blend INTO the record rather than out of it

See stream/README.md for how to run it.
"""

import subprocess
import sys

import numpy as np

RATE = 44_100
HOP = 256
WIN = 2048

MUSIC_HZ = 1300.0  # the record the cue is armed against
VOICE_HZ = 7000.0
ASKED_FOR_S = 6.0
BLEND_IN_S = 4.0
BLEND_OUT_S = 8.0


def decode(path: str) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4")


def envelope(samples: np.ndarray, freq: float) -> np.ndarray:
    frames = (len(samples) - WIN) // HOP + 1
    t = np.arange(WIN) / RATE
    ref = np.exp(-2j * np.pi * freq * t) * np.hanning(WIN)
    return np.array([abs(np.dot(samples[i * HOP : i * HOP + WIN], ref)) * 4.0 / WIN for i in range(frames)])


def onset(env: np.ndarray, per_frame: float) -> float | None:
    """When the tone first appears. Threshold at 1% of its own steady level."""
    peak = env.max()
    if peak <= 0:
        return None
    lit = np.flatnonzero(env > peak * 0.01)
    return float(lit[0] * per_frame) if lit.size else None


def main(path: str) -> int:
    samples = decode(path)
    per_frame = HOP / RATE

    music = onset(envelope(samples, MUSIC_HZ), per_frame)
    voice = onset(envelope(samples, VOICE_HZ), per_frame)

    print(f"rendered {len(samples) / RATE:.2f}s")
    if music is None:
        print("the record under test never played")
        return 1
    if voice is None:
        print("the cue never fired -- it expired, or it was never due before the record ended")
        return 1

    landed = voice - music
    print(f"  record became audible at {music:6.2f}s  (start of the {BLEND_IN_S:.0f}s blend into it)")
    print(f"  voice started at         {voice:6.2f}s")
    print(f"  so the break landed {landed:.2f}s into the record; the app asked for {ASKED_FOR_S:.1f}s\n")

    error = landed - ASKED_FOR_S
    if abs(error) <= 0.5:
        print("CORRECTION IS RIGHT: the break lands where it was asked for.")
        return 0

    print(f"WRONG by {error:+.2f}s: the break lands {'late' if error > 0 else 'early'}.")
    # Name the two failures that have a known shape, so the fix is not guesswork.
    if abs(error - BLEND_OUT_S) <= 0.5:
        print(f"  That is exactly the blend OUT of the record ({BLEND_OUT_S:.0f}s), which is what the")
        print("  correction adds. The true lag is zero: the on_track fires at the same instant the")
        print("  listener first hears the record, so nothing should be added at all.")
    elif abs(error - (BLEND_OUT_S - BLEND_IN_S)) <= 0.5:
        print(f"  That is the difference between the two blends ({BLEND_OUT_S:.0f} - {BLEND_IN_S:.0f}), so the lag is real")
        print("  but it is the blend INTO the record, not out of it. The correction reads the wrong key.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "stream/voicecue.check.wav"))
