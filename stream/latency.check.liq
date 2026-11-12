# What does the clock do with a stall: burst the backlog, or drop it?
#
# A tone plays from the start. At five seconds a metadata packet is inserted, and a synchronous
# handler on it holds the streaming loop for twenty seconds, which is what a stall on the live
# station looks like from inside Liquidsoap (the log says nothing for the length of it, then
# "we must catchup N seconds"). At forty seconds of wall time the run stops and prints how much
# audio the source had produced by then. What `latency.check.py` reads back:
#
#   with the cap radio.liq sets, about twenty seconds LESS audio than wall time: the backlog was
#   dropped, and "Too much latency" is in the log
#   with Liquidsoap's own sixty seconds (CLOCK_MAX_LATENCY_S=60), audio equal to wall time: the
#   backlog was produced as fast as the clock could go, which on an Icecast mount is a burst that
#   every listener connected through it carries as delay for the rest of their session
#
# Run with stream/latency.check.py, which runs this in the pinned image twice. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 2

def env_float(name, default) =
  string.to_float(default=default, environment.get(default="", name))
end

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
settings.clock.max_latency := max(1., env_float("CLOCK_MAX_LATENCY_S", 8.))
# ── END copied from radio.liq ────────────────────────────────────────────────────

started = time()
def elapsed() =
  time() - started
end

tone = sine(440.)
tone.on_metadata(synchronous=true, fun (_) -> begin
  print("stall from #{elapsed()}")
  ignore(process.run("sleep 20"))
  print("stall to #{elapsed()}")
end)

thread.run(delay=5., fun () -> tone.insert_metadata([("title", "stall")]))
# Counted frame by frame rather than read off `tone.time()`, which follows the clock's tick count:
# the reset moves that count to now, so it reads the same either way.
frames = ref(0)
tone.on_frame(synchronous=true, fun () -> frames := frames() + 1)

thread.run(delay=40., fun () -> begin
  print("produced #{float_of_int(frames()) * frame.duration()} wall #{elapsed()}")
  shutdown()
end)

output.dummy(fallible=false, tone)
