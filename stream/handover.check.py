"""Measures the filtered handover in `handover.check.liq`, against the plain fade. See stream/README.md.

Renders both transitions in the pinned Liquidsoap image (Docker, no dev stack needed) over the same
synthetic records, then reads every record's bass, mid and top tone off its own frequency. Given a
directory holding a plain.wav and a filtered.wav, it measures those instead of rendering.

  bass fight     how long two basslines are both audible and within 6 dB of each other
  top and mid    what the sweep and the duck took off the outgoing record, against the plain fade
  outside        whether the audio outside the overlaps is the same audio, sample for sample
  clicks         the energy above every tone, which is where a step in the signal shows up

`--listen outgoing incoming directory [blend seconds]` renders both over two real records instead, to hear.

`filter`, and not `filter.iir.butterworth.high`: on 2.4.5 an order-4 Butterworth saturates a plain
record at full scale at any corner tried (200 Hz and 2 kHz), where order 2 does not.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

RATE = 44_100
IMAGE = "savonet/liquidsoap:v2.4.5"
HERE = os.path.dirname(os.path.abspath(__file__))
SECONDS = 12.0
RECORDS = {
    "a": ((80.0, 1000.0, 6000.0), 0.15),
    "b": ((110.0, 1370.0, 7300.0), 0.15),
    "c": ((65.0, 870.0, 5300.0), 0.15),
    "d": ((95.0, 1210.0, 6700.0), 0.15),
    "e": ((73.0, 1530.0, 4700.0), 0.02),
}
# (outgoing, incoming, stamped seconds, when the overlap starts). Each record is twelve seconds, and
# every overlap takes its own length off the timeline. c into d is the hard join.
BOUNDARIES = [("a", "b", 4.0, 8.0), ("b", "c", 8.0, 12.0), ("d", "e", 6.0, 30.0)]
HOP = 441
WIN = 8192
BASS_AT = 0.4
AUDIBLE_DB = -30.0
FIGHT_DB = 6.0
NOISE_RMS = 0.2
CLICK_ABOVE_HZ = 9000.0
LISTEN_S = 24


def write_records(directory):
    t = np.arange(int(SECONDS * RATE)) / RATE
    for name, (freqs, level) in RECORDS.items():
        mix = sum(level * np.sin(2 * np.pi * f * t) for f in freqs)
        pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
        with wave.open(os.path.join(directory, f"{name}.wav"), "wb") as out:
            out.setnchannels(2)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes(np.repeat(pcm, 2).tobytes())


def write_noise(directory):
    """The same five names as pink noise at about mastered level, because three equal tones say nothing
    about how loud a blend is: a record's energy is mostly in its low end, and the sweep leaves that."""
    os.makedirs(directory, exist_ok=True)
    rng = np.random.default_rng(7)
    count = int(SECONDS * RATE)
    for name in RECORDS:
        spectrum = np.fft.rfft(rng.standard_normal(count))
        spectrum[1:] /= np.sqrt(np.fft.rfftfreq(count, 1 / RATE)[1:])
        mix = np.fft.irfft(spectrum, count)
        mix *= NOISE_RMS / np.sqrt(np.mean(mix**2))
        pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
        with wave.open(os.path.join(directory, f"{name}.wav"), "wb") as out:
            out.setnchannels(2)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes(np.repeat(pcm, 2).tobytes())


def render(directory):
    """All four at once, since each takes the render's length in real time and none of them is heavy."""
    write_records(directory)
    write_noise(os.path.join(directory, "noise"))
    renders = " ".join(
        f"(HANDOVER_MODE={mode} HANDOVER_OUT={where}/{mode}.wav HANDOVER_DIR={where} timeout 100 liquidsoap /w/h.liq 2>&1 | grep -E 'rror|xception') &"
        for mode in ("plain", "filtered")
        for where in ("/w", "/w/noise")
    )
    script = f"cp /s/handover.check.liq /w/h.liq; chmod -R a+rw /w; {renders} wait"
    subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{HERE}:/s:ro", "-v", f"{directory}:/w", IMAGE, "-c", script],
        check=False,
    )


def decode(path):
    # One channel, not a downmix: ffmpeg's `-ac 1` reads an identical pair 3 dB up.
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-af", "pan=mono|c0=c0", "-ar", str(RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4")


def envelope(samples, freq):
    """A tone's amplitude over time, by demodulating at its frequency through a Hann window."""
    t = np.arange(len(samples)) / RATE
    window = np.hanning(WIN)
    window /= window.sum()
    size = len(samples) + WIN
    product = np.fft.irfft(np.fft.rfft(samples * np.cos(2 * np.pi * freq * t), size) * np.fft.rfft(window, size), size)
    quadrature = np.fft.irfft(np.fft.rfft(samples * np.sin(2 * np.pi * freq * t), size) * np.fft.rfft(window, size), size)
    amplitude = 2 * np.hypot(product, quadrature)[WIN // 2 : WIN // 2 + len(samples)]
    return amplitude[::HOP]



def db(x):
    return 20 * np.log10(np.maximum(x, 1e-6))


def at(env, seconds):
    return env[int(seconds * RATE / HOP)]


def fight_seconds(env_a, env_b, level_a, level_b, start, length):
    """How long both basses are audible and within FIGHT_DB of one another."""
    lo, hi = int(start * RATE / HOP), int((start + length) * RATE / HOP)
    a, b = db(env_a[lo:hi] / level_a), db(env_b[lo:hi] / level_b)
    return float(np.sum((a > AUDIBLE_DB) & (b > AUDIBLE_DB) & (np.abs(a - b) < FIGHT_DB))) * HOP / RATE


def above_every_tone(samples):
    """The signal above the top tone, by FFT. A pure tone has nothing there, so this is only steps."""
    spectrum = np.fft.rfft(samples)
    spectrum[np.fft.rfftfreq(len(samples), 1 / RATE) < CLICK_ABOVE_HZ] = 0
    return np.fft.irfft(spectrum, len(samples))


def write_excerpts(directory, outgoing, incoming):
    """Two real records in the first two slots, and silence in the other three, for listening to."""
    for name, source in (("a", outgoing), ("b", incoming)):
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", "60", "-t", str(LISTEN_S), "-i", source, "-ac", "2", "-ar", str(RATE), os.path.join(directory, f"{name}.wav")],
            check=True,
        )
    for name in ("c", "d", "e"):
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo", "-t", "9", os.path.join(directory, f"{name}.wav")],
            check=True,
        )


def render_excerpts(directory, seconds):
    renders = " ".join(
        f"(HANDOVER_FIRST_BLEND={seconds:.1f} HANDOVER_MODE={mode} HANDOVER_OUT=/w/{mode}.wav HANDOVER_DIR=/w timeout 100 liquidsoap /w/h.liq 2>&1 | grep -E 'rror|xception') &"
        for mode in ("plain", "filtered")
    )
    script = f"cp /s/handover.check.liq /w/h.liq; chmod -R a+rw /w; {renders} wait"
    subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", "-v", f"{HERE}:/s:ro", "-v", f"{directory}:/w", IMAGE, "-c", script],
        check=False,
    )


def main():
    if len(sys.argv) in (5, 6) and sys.argv[1] == "--listen":
        seconds = float(sys.argv[5]) if len(sys.argv) == 6 else 4.0
        os.makedirs(sys.argv[4], exist_ok=True)
        write_excerpts(sys.argv[4], sys.argv[2], sys.argv[3])
        render_excerpts(sys.argv[4], seconds)
        print(f"{sys.argv[4]}/plain.wav and filtered.wav: the blend is {LISTEN_S - seconds:g}s in, and lasts {seconds:g}s")
        return
    work = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="handover.")
    try:
        if len(sys.argv) <= 1:
            render(work)
        plain, filtered = decode(os.path.join(work, "plain.wav")), decode(os.path.join(work, "filtered.wav"))
        noise_plain = decode(os.path.join(work, "noise", "plain.wav"))
        noise_filtered = decode(os.path.join(work, "noise", "filtered.wav"))
        print(f"rendered {len(plain) / RATE:.2f}s plain, {len(filtered) / RATE:.2f}s filtered (records played end to end would be 60s)")
        length = min(len(plain), len(filtered))
        difference = np.abs(plain[:length] - filtered[:length])

        spans = [(s, s + n) for _, _, n, s in BOUNDARIES]
        outside = np.ones(length, dtype=bool)
        for start, end in spans:
            outside[int(start * RATE) - RATE // 10 : int(end * RATE) + RATE // 10] = False
        print(f"outside the overlaps: largest sample difference {difference[outside].max():.6f} (one 16-bit step is {1 / 32768:.6f})")
        changed = np.flatnonzero(difference > 2 / 32768)
        if len(changed):
            print(f"first and last changed sample: {changed[0] / RATE:.3f}s, {changed[-1] / RATE:.3f}s")

        clicks_plain, clicks_filtered = above_every_tone(plain), above_every_tone(filtered)
        for outgoing, incoming, seconds, start in BOUNDARIES:
            (bass_a, mid_a, top_a), level_a = RECORDS[outgoing]
            (bass_b, _, _), level_b = RECORDS[incoming]
            print(f"\n{outgoing} into {incoming}, {seconds:g}s from {start:g}s")
            for name, samples in (("plain", plain), ("filtered", filtered)):
                a, b = envelope(samples, bass_a), envelope(samples, bass_b)
                print(f"  {name:9} basses fighting for {fight_seconds(a, b, level_a, level_b, start, seconds):.2f}s")
            for label, freq in (("bass", bass_a), ("mid", mid_a), ("top", top_a)):
                p, f = envelope(plain, freq), envelope(filtered, freq)
                row = "  ".join(f"{int(q * 100)}%: {db(at(f, start + q * seconds) / max(at(p, start + q * seconds), 1e-6)):+6.1f}" for q in (0.1, 0.3, 0.5, 0.7, 0.9))
                print(f"  outgoing {label:4} against the plain fade, dB at  {row}")
            p, f = envelope(plain, bass_a), envelope(filtered, bass_a)
            handed = np.flatnonzero(db(f[int(start * RATE / HOP) : int((start + seconds) * RATE / HOP)]) < db(p[int(start * RATE / HOP) : int((start + seconds) * RATE / HOP)]) - 6)
            if len(handed):
                print(f"  outgoing bass is 6 dB under the plain fade from {handed[0] * HOP / RATE / seconds:.0%} of the overlap (asked for {BASS_AT:.0%})")
            p, f = envelope(plain, bass_b), envelope(filtered, bass_b)
            row = "  ".join(f"{int(q * 100)}%: {db(at(f, start + q * seconds) / max(at(p, start + q * seconds), 1e-6)):+6.1f}" for q in (0.1, 0.3, 0.5, 0.7, 0.9))
            print(f"  incoming bass against the plain fade, dB at  {row}")
            for name, samples in (("plain", noise_plain), ("filtered", noise_filtered)):
                piece = samples[int(start * RATE) : int((start + seconds) * RATE)]
                power = np.array([np.sqrt(np.mean(piece[i : i + RATE // 2] ** 2)) for i in range(0, len(piece) - RATE // 2, RATE // 4)])
                print(f"  {name:9} level over the overlap on pink noise, dB: lowest {db(power.min()):+.2f}  highest {db(power.max()):+.2f}")
            lo, hi = int(start * RATE), int((start + seconds) * RATE)
            print(f"  largest step above {CLICK_ABOVE_HZ:g} Hz: plain {db(np.abs(clicks_plain[lo:hi]).max()):+.1f} dB, filtered {db(np.abs(clicks_filtered[lo:hi]).max()):+.1f} dB")
    finally:
        if len(sys.argv) <= 1:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
