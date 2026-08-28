# Does `output.file.hls` actually start, with the encoders and options radio.liq gives it?
#
# `--check` type-checks a script and does not RUN its outputs, so it cannot answer this: the
# HLS output type-checked clean and then failed at startup, taking the whole script — and both
# Icecast mounts — with it. This is the smallest thing that reproduces that, against silence
# and a temporary directory, so the answer costs no airtime.
#
# Run it, and read the log rather than the exit code: an output that fails to start says so and
# the process keeps going.
#
#   docker compose exec -T liquidsoap sh -c 'rm -rf /tmp/hlscheck; mkdir -p /tmp/hlscheck; cat > /tmp/h.liq; timeout 20 liquidsoap /tmp/h.liq 2>&1 | grep -iE "hls|error|exception|invalid|permission"; echo "--- files ---"; ls -la /tmp/hlscheck' < stream/hlsout.check.liq
#
# Point it at the REAL directories to tell a broken call apart from a broken path:
#
#   docker compose exec -T -e CHECK_HLS_DIR=/streamhls -e CHECK_PERSIST_AT=/streamstate/hls.json \
#     liquidsoap sh -c 'cat > /tmp/h.liq; timeout 20 liquidsoap /tmp/h.liq 2>&1 | tail -20; ls -la /streamhls' < stream/hlsout.check.liq
#
# Segment files in /tmp/hlscheck mean the output works and the fault is in how radio.liq calls
# it (a path, a permission, the persist file). No files plus an error line is the output itself
# refusing these arguments, and the line says which.

settings.init.allow_root := true
settings.log.level := 4

s = mksafe(blank())

# The same two variants radio.liq builds, at the same default rates. Both encoders are present
# in this image (measured), so a failure here is about HLS packaging rather than the codec.
streams = [("aac", %fdkaac(bitrate=192)), ("mp3", %mp3(bitrate=128))]

output.file.hls(
  playlist = "live.m3u8",
  segment_duration = 2.0,
  segments = 6,
  segments_overhead = 5,
  persist_at = environment.get("CHECK_PERSIST_AT", default="/tmp/hlscheck/state.json"),
  environment.get("CHECK_HLS_DIR", default="/tmp/hlscheck"),
  streams,
  s
)

# Stop on its own, so the harness needs no signal handling.
thread.run(delay=14., fun () -> shutdown())
