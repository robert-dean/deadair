# docs/todo

Work that has been designed and deliberately deferred, plus the seam each piece drops into when it
lands. With one named exception (`todo.md`, at the bottom of the table), this is not a backlog of
ideas: everything here was scoped against the real tree during some piece of work, then cut to keep
that pass on one thing. The point of writing it down is that none of it needs re-deciding, only
building.

Two rules for this directory:

- **A file here describes the current tree**, with two exceptions: `from-v1.md`, which is explicitly
  a map of the pre-re-scaffold station and says so on every claim, and `todo.md`, which is the raw
  idea list and is scoped against nothing. See `docs/decisions/` for calls that were made and
  closed, and the run directories under `.claude/handoffs/` for work that was decomposed and built.
- **Verify before building.** These notes name tables, columns and modules as they stood on the date
  in each file's header. Check `apps/api/src/modules/modules.ts` and the migrations before relying
  on any of it.

| File | What it covers |
| --- | --- |
| [dj-voice.md](dj-voice.md) | What stands between a station that plays segments and one with a DJ. The TTS, the settings console and the `llm` capability are all built; the writer that decides what a break says is what is left, and the file's last section orders the remaining work against listening to the station all day |
| [director-and-lineups.md](director-and-lineups.md) | Segments, an LLM DJ, live provider search, the daypart schedule, station permissions, plugins that programme the station, push destinations, rotation rules as settings, palette steering, the station console page |
| [station-intelligence.md](station-intelligence.md) | The layer above the rules: an LLM DJ on the `SetGenerator` seam, model budget and degradation tiers, ending-aware transitions, per-track gain, never-play rules, genre and era correctness, listener signal, and what the console can tell an operator about silence |
| [station-moment.md](station-moment.md) | The clock, the calendar and the weather as one resolver both the selector and the writers read: an operator-editable mood vocabulary, the day's lean, occasions, and why mood-biased selection is blocked and mood-flavoured talk is not |
| [tool-plugins.md](tool-plugins.md) | A `tool` capability so a plugin can be something the model calls mid-sentence (weather, news, RSS), and which tools are host-side sources instead |
| [multi-station.md](multi-station.md) | A `deadair.stations` table so one install runs several stations, and what it subsumes |
| [rundown.md](rundown.md) | What the rundown deliberately does not do yet: persistence and playhead corroboration, and why neither turned out to be a prerequisite for breaks |
| [crossfades.md](crossfades.md) | Blending one rundown item into the next, and why the cross buffer has to be paid for in the voice cue timing before it can land. Second on the near-term order below, and no longer blocked: the cue points it needs a number from were measured on 2026-08-11 |
| [track-analysis.md](track-analysis.md) | **Mostly done** (2026-08-11): the sidecar, the `analysis` capability, the four cue points and the loudness layer are built and measured. What remains is the beat layer (tempo, confidence, downbeats, vocal onset and curve) and the licence question it carries |
| [mixer-settings-in-db.md](mixer-settings-in-db.md) | The four constants that decide how a break sounds, and the settings seam they bypass. **Smaller than it was** (2026-08-11): the restart trigger this file called the real work now exists, so what is left is four `STREAM_KEYS` entries and one decision about when to spend the restart |
| [listening-loop.md](listening-loop.md) | Closing the loop between the station and where the operator actually listens: the mount reachable from a phone and a car, the taste signal coming back from what is played elsewhere, the station's own history going out, and the single Spotify re-consent all of it should be batched into |
| [spotify-listening-profile.md](spotify-listening-profile.md) | The top-tracks, top-artists and saved-library data the Spotify grant already asks for and never reads, the two shapes that could carry it, and what the February 2026 API round did and did not take |
| [spotify-api-currency.md](spotify-api-currency.md) | Where the Spotify plugin has fallen behind the Web API. The two search-limit bugs were fixed on the spot; still open are the two scopes that unlock nothing, the SDK's removed batch overload, `account_id`, and the Premium requirement development mode grew |
| [youtube-music.md](youtube-music.md) | A third music provider, split into a catalog half that is ordinary plugin code and an audio half that is a second track fetcher and a sidecar, plus the two pieces of the host that stop being Spotify-shaped when it lands |
| [stream-formats.md](stream-formats.md) | Why incoming audio already needs nothing, and the Opus/AAC/FLAC mounts and hourly archive the station does not serve |
| [stream-latency.md](stream-latency.md) | **Optional, and deliberately not on the order below.** What the monitor's "2.3s behind" actually measures (one browser's buffer, not end-to-end), why the server side is already at its floor, the one unrun diagnostic that would settle it, and the real-time transport that would close it properly. Kept for the five things that transport collides with, one of which would silently mute the station |
| [now-playing-displays.md](now-playing-displays.md) | Artwork and split track fields on a hardware player (BluOS), why the stream itself can never carry them, the display-sink capability the SDK lacks, and the one probe that decides whether it is buildable |
| [icecast-2.5.md](icecast-2.5.md) | **Mostly done** (2026-08-10): the container runs 2.5.0, the poll reads `/admin/publicstats` and the audience follows `/admin/eventfeed`. Kept for the two document shapes measured off a live 2.5, which match neither the old endpoint nor upstream's source, and for the four small leftovers |
| [service-actors.md](service-actors.md) | Giving Liquidsoap and Icecast their own credentials, actor kind and permission tuples instead of one shared bridge secret |
| [from-v1.md](from-v1.md) | Things the previous station did that this tree will eventually want back: the render pipeline, breaks, shows, the monitoring feed, extra sources, now-playing sinks |
| [todo.md](todo.md) | The station's raw idea list, and **the one file here that is exempt from the two rules above**: unscoped, undesigned, and not checked against the tree. An entry graduates out of it by being designed against real code, at which point it becomes a file above and the line here points at it |

## What is next, and against what test

**Set 2026-08-09.** Most of this directory is ordered by subsystem. The near-term work is not: the
target is a station the operator leaves on all day in place of a streaming service, and that test
ranks these files differently from how they read. Selection is already good enough for it and needs
no pass. What is left, in order:

1. ~~**The deterministic break writer**, and `BreakPlanner` planting `planned` segments rather than
   only choosing ready idents.~~ **Built 2026-08-09**, alternating with recorded idents. Cue
   visibility did NOT ride with it, because breaks are planted between records rather than over them;
   see [dj-voice.md](dj-voice.md) for what shipped and what that leaves.
2. **[Crossfades](crossfades.md)**, once breaks are landing reliably, because the cross buffer moves
   the clock those breaks are timed against. It grew a prerequisite on 2026-08-10 — the per-track
   measurement in [station-intelligence.md](station-intelligence.md) §3 — and **that prerequisite
   was met on 2026-08-11**: the sidecar measures the four cue points, so `outro` and `intro` are
   real numbers and `buffer = min(outgoing.outro, incoming.intro)` can be computed today. The blend
   POLICY inside the buffer still wants the beat layer, which is not built and carries the licence
   question; a plain per-pair blend does not, and is what this item now means.
3. **A model as the writer's second binding**, with the deterministic one kept underneath as the
   floor rather than as scaffolding.
4. **The activity feed** over the segment transitions the two writers produce, which is why those
   transitions are recorded as facts while they are written rather than afterwards.

Everything else in the table is deferred behind those four unless something specific pulls it
forward.

**Landed since, 2026-08-11**, and none of it was on this list: the measurement layer under item 2.
`analysis/` is a sidecar, `plugins/analyzer` the adapter, `analysis` a capability of its own rather
than a kind of enrichment, and `deadair.track_analysis` the row. Two things an operator can hear
came with it and were not deferred behind the crossfade — the dead air trimmed off the head and tail
of every record (`liq_cue_in` / `liq_cue_out`), and a per-record level decided before air rather than
chased by a follower ([station-intelligence.md](station-intelligence.md) §4). The beat layer under
the same sidecar is untouched.

**One thing does pull itself forward**, added the same day: the four above assume listening at the
desk, which is where the station is audible and nowhere else. Replacing a streaming service means
being audible on a phone and in a car too, and that is infrastructure rather than app code. See
[listening-loop.md](listening-loop.md). It competes with item 1 rather than slotting behind it: the
writer makes the station worth listening to, reachability makes it possible to, and which comes first
depends on whether the next week of listening happens at the desk or not.
