# docs/todo

Work that has been designed and deliberately deferred, plus the seam each piece drops into when it
lands. This is not a backlog of ideas: everything here was scoped against the real tree during some
piece of work, then cut to keep that pass on one thing. The point of writing it down is that none of
it needs re-deciding, only building.

Two rules for this directory:

- **A file here describes the current tree**, with one exception: `from-v1.md`, which is explicitly a
  map of the pre-re-scaffold station and says so on every claim. See `docs/decisions/` for calls that
  were made and closed, and the run directories under `.claude/handoffs/` for work that was
  decomposed and built.
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
| [crossfades.md](crossfades.md) | Blending one rundown item into the next, and why the cross buffer has to be paid for in the voice cue timing before it can land. Second on the near-term order below |
| [track-analysis.md](track-analysis.md) | Where per-track measurement comes from, shared by three features that each assumed their own answer: the fields, the beat layer under them, why decoding is what makes the placement hard, and the staleness rules. Its loudness section is the smallest thing in this directory with a consumer already designed, and the only one that does not wait on the beat layer's licence question |
| [mixer-settings-in-db.md](mixer-settings-in-db.md) | The four constants that decide how a break sounds, the settings seam they bypass, and the restart trigger that is the real work |
| [listening-loop.md](listening-loop.md) | Closing the loop between the station and where the operator actually listens: the mount reachable from a phone and a car, the taste signal coming back from what is played elsewhere, the station's own history going out, and the single Spotify re-consent all of it should be batched into |
| [spotify-listening-profile.md](spotify-listening-profile.md) | The top-tracks, top-artists and saved-library data the Spotify grant already asks for and never reads, the two shapes that could carry it, and what the February 2026 API round did and did not take |
| [spotify-api-currency.md](spotify-api-currency.md) | Where the Spotify plugin has fallen behind the Web API. The two search-limit bugs were fixed on the spot; still open are the two scopes that unlock nothing, the SDK's removed batch overload, `account_id`, and the Premium requirement development mode grew |
| [youtube-music.md](youtube-music.md) | A third music provider, split into a catalog half that is ordinary plugin code and an audio half that is a second track fetcher and a sidecar, plus the two pieces of the host that stop being Spotify-shaped when it lands |
| [stream-formats.md](stream-formats.md) | Why incoming audio already needs nothing, and the Opus/AAC/FLAC mounts and hourly archive the station does not serve |
| [now-playing-displays.md](now-playing-displays.md) | Artwork and split track fields on a hardware player (BluOS), why the stream itself can never carry them, the display-sink capability the SDK lacks, and the one probe that decides whether it is buildable |
| [icecast-2.5.md](icecast-2.5.md) | **Mostly done** (2026-08-10): the container runs 2.5.0, the poll reads `/admin/publicstats` and the audience follows `/admin/eventfeed`. Kept for the two document shapes measured off a live 2.5, which match neither the old endpoint nor upstream's source, and for the four small leftovers |
| [service-actors.md](service-actors.md) | Giving Liquidsoap and Icecast their own credentials, actor kind and permission tuples instead of one shared bridge secret |
| [from-v1.md](from-v1.md) | Things the previous station did that this tree will eventually want back: the render pipeline, breaks, shows, the monitoring feed, extra sources, now-playing sinks |

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
   the clock those breaks are timed against. Note it grew a prerequisite on 2026-08-10: the
   per-track measurement in [station-intelligence.md](station-intelligence.md) §3, which is what
   decides how long a blend should be. Nothing can be bought that answers that, so the measurement
   is part of the crossfade work rather than an alternative to it.
3. **A model as the writer's second binding**, with the deterministic one kept underneath as the
   floor rather than as scaffolding.
4. **The activity feed** over the segment transitions the two writers produce, which is why those
   transitions are recorded as facts while they are written rather than afterwards.

Everything else in the table is deferred behind those four unless something specific pulls it
forward.

**One thing does pull itself forward**, added the same day: the four above assume listening at the
desk, which is where the station is audible and nowhere else. Replacing a streaming service means
being audible on a phone and in a car too, and that is infrastructure rather than app code. See
[listening-loop.md](listening-loop.md). It competes with item 1 rather than slotting behind it: the
writer makes the station worth listening to, reachability makes it possible to, and which comes first
depends on whether the next week of listening happens at the desk or not.
