"""Measures what `crossfade.check.liq` rendered. See stream/README.md for how to run it.

Each synthetic record is a pure tone at a frequency no other one is a harmonic of,
so its amplitude at any instant can be read straight off its own DFT bin without
the others leaking into it. Four envelopes, one per record, and every claim about a
boundary becomes arithmetic on two of them:

  overlap      how long both were audible, against what the stamp asked for
  power sum    whether the pair holds constant power across the overlap, which is
               the +6 dB lurch stated as a number rather than as a listening note
  hard join    whether a boundary the station does not blend produced no overlap
"""

import subprocess
import sys

import numpy as np

RATE = 44_100
TONES = {"a": 400.0, "b": 1300.0, "c": 2700.0, "d": 5300.0}
BOUNDARIES = [("a", "b", 4.0), ("b", "c", 0.0), ("c", "d", 8.0)]

HOP = 256
WIN = 2048
# A tone is "present" above this fraction of its own steady-state level. Deliberately
# tiny: an equal-power fade reaches 10% of full amplitude in the first 6% of its
# length, so a 10% threshold reads every overlap about half a second short. At 1% the
# reading is within 1.5% of the true length, and the rest is window smear.
PRESENT = 0.01

# Below this an "overlap" is two frames of analysis window straddling a hard cut
# rather than a blend, and the power check on it means nothing.
NO_OVERLAP_S = 0.15

# How far the combined power may stray before the pair is not equal-power. A linear
# crossfade dips exactly 3.01 dB at its midpoint and a fade shorter than the buffer
# rises up to 6 dB, so +/-1 dB separates the right answer from both wrong ones with
# room to spare.
POWER_TOLERANCE_DB = 1.0


def decode(path: str) -> np.ndarray:
    """One mono channel of float samples, via ffmpeg so the container's format choice does not matter."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4")


def envelope(samples: np.ndarray, freq: float) -> np.ndarray:
    """Amplitude of one tone over time, by complex demodulation at its own frequency.

    A plain windowed DFT bin would smear across the 4 Hz-wide bins a 2048 window
    gives; demodulating and low-passing reads the amplitude directly and is exact
    for a pure tone.
    """
    frames = (len(samples) - WIN) // HOP + 1
    t = np.arange(WIN) / RATE
    ref = np.exp(-2j * np.pi * freq * t) * np.hanning(WIN)
    # Hann halves the coherent gain; the 4 puts the answer back in peak amplitude.
    scale = 4.0 / WIN
    out = np.empty(frames)
    for i in range(frames):
        chunk = samples[i * HOP : i * HOP + WIN]
        out[i] = abs(np.dot(chunk, ref)) * scale
    return out


def steady(env: np.ndarray) -> float:
    """The tone's level when it is playing alone: the median of everything audible."""
    lit = env[env > env.max() * 0.5]
    return float(np.median(lit)) if lit.size else 0.0


def span(env: np.ndarray, floor: float) -> tuple[int, int]:
    """First and last frame where the tone is present."""
    lit = np.flatnonzero(env > floor)
    return (int(lit[0]), int(lit[-1])) if lit.size else (-1, -1)


def main(path: str) -> int:
    samples = decode(path)
    seconds = len(samples) / RATE
    print(f"rendered {seconds:.2f}s, {len(samples)} samples\n")

    envs = {name: envelope(samples, freq) for name, freq in TONES.items()}
    levels = {name: steady(env) for name, env in envs.items()}
    per_frame = HOP / RATE

    for name, env in envs.items():
        first, last = span(env, levels[name] * PRESENT)
        if first < 0:
            print(f"  tone {name} ({TONES[name]:.0f} Hz): NEVER PRESENT")
        else:
            print(f"  tone {name} ({TONES[name]:.0f} Hz): {first * per_frame:6.2f}s -> {last * per_frame:6.2f}s  level {levels[name]:.3f}")
    print()

    failures = 0
    for out_name, in_name, expected in BOUNDARIES:
        out_env, in_env = envs[out_name], envs[in_name]
        both = (out_env > levels[out_name] * PRESENT) & (in_env > levels[in_name] * PRESENT)
        overlap = int(both.sum()) * per_frame

        label = f"{out_name} -> {in_name}"
        ok = abs(overlap - expected) <= 0.40
        failures += not ok
        verdict = "ok" if ok else "MISMATCH"
        print(f"{label}: overlap {overlap:5.2f}s, expected {expected:4.1f}s  [{verdict}]")

        if overlap < NO_OVERLAP_S:
            print("    no overlap, which is what a hard join should look like\n")
            continue

        # The +6 dB question. Two equal-power fades hold sum-of-squares constant; a
        # fade shorter than the buffer leaves the outgoing track at full level while
        # the incoming ramps in, and this rises by up to 6 dB in the middle.
        lit = np.flatnonzero(both)
        # Normalise each tone by its own solo level, so an amplitude difference
        # between the two records cannot look like a power error.
        a_n = out_env[lit] / levels[out_name]
        b_n = in_env[lit] / levels[in_name]
        power = a_n**2 + b_n**2
        # Trim the first and last few frames: the analysis window straddles the edge
        # of the overlap there and reads both tones low.
        edge = min(8, len(power) // 4)
        core = power[edge:-edge] if len(power) > 2 * edge else power
        peak_db = 10 * np.log10(core.max()) if core.size else 0.0
        dip_db = 10 * np.log10(core.min()) if core.size else 0.0

        flat = peak_db <= POWER_TOLERANCE_DB and dip_db >= -POWER_TOLERANCE_DB
        failures += not flat
        print(f"    combined power across the overlap: {dip_db:+.2f} dB to {peak_db:+.2f} dB  [{'ok' if flat else 'NOT EQUAL POWER'}]")

        # Monotonic in both directions is what a fade is; a non-monotonic envelope
        # means something is modulating that should not be.
        def monotonic(v: np.ndarray, rising: bool) -> bool:
            smooth = np.convolve(v, np.ones(9) / 9, mode="valid")
            d = np.diff(smooth)
            return bool((d >= -0.02).all()) if rising else bool((d <= 0.02).all())

        shapes = monotonic(b_n, True) and monotonic(a_n, False)
        failures += not shapes
        print(f"    envelopes monotonic (out falls, in rises): {'ok' if shapes else 'NO'}\n")

    print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "stream/crossfade.check.wav"))
