# Internals: carrying somebody else's programme

How the station airs an episode of a podcast it did not make: the capability, the table that
remembers what the station did with each episode, the fetch, the format clock, and what the episode
is on air. What a PRODUCED programme is (a `podcast` band the station writes and speaks) is
[`productions.md`](productions.md); this is the other thing.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md). `apps/api/scripts/podcast.smoke.ts` runs the table's claims against a
real database.

## An episode is a segment, not a record

**The obvious shape was a music provider whose playlists are shows and whose tracks are episodes, and
it is wrong everywhere it touches.** It needs no new capability and no host change to get an episode
into the catalog, and then the catalog treats it as a song. Every row below is a rule about records
that is right for a four-minute song and wrong for an hour of somebody else's show:

| Rule | Where | What it does to an episode |
| --- | --- | --- |
| The audio fetch ceiling | `MAX_TRACK_BYTES`, 64 MiB, 90 s | refuses a 90-minute episode outright |
| Measurement | `analysis/app.py`, `MAX_SECONDS` 1800 | decodes half an hour, reports `complete: false` |
| Rotation | `PickResolver`, the weighted draw | draws it into ordinary programming |
| Artist spacing and cooldown | `rotation.rules.ts` | spaces the show like a band |
| Length caps | `rotation.maxTrackSeconds` | an operator's song cap vetoes every episode |
| Enrichment | the walk has no kind gate | searches MusicBrainz for it forever, on a backoff |
| Crossfading | `blendFor` | fades a record into the start of a programme |
| Play history | `DirectorService.remember` | puts a show's name into the song key space |
| Scrobbling | `waitFor`, capped at four minutes | sends an hour-long programme to Last.fm as a track |
| Ingest | `catalog.resolver.service.ts` | demands a lead artist, so the show has to pose as a band |

The station already had the other shape: a stitched production is one `ready` segment that airs
whole, is spoken word to the mixer, is left out of history and scrobbling, and is booked by a clock
band. Migration 0008 named "a whole show episode" as a segment before anything made one. So an episode
is fetched into the segment store and airs as a segment, and none of the rows above had to learn what
a podcast is.

**It is its own capability, `podcast`, on `news`'s model** (`capabilities/podcast.ts`). A plugin says
what shows it carries and what each published, each episode with the ADDRESS of its audio, and the
host fetches that address itself. Two reasons it is the host: an episode is far larger than any body
`host.fetch` lets a plugin read, and raising that bound for one capability raises it for every plugin;
and when the audio is wanted is a clock decision no plugin can see. `searchShows` is an optional
directory answering `PodcastDirectoryEntry`, which is not a `PodcastShow`, since a directory's id is
its own and a feed address is what subscribing needs. There is no subscribe method, because what a
subscription is belongs to each plugin.

**The word is `syndicated`, not `podcast`.** A band's kind decides who fills it, and `podcast` is
already the production scheduler's (`render.productionKinds` defaults to `podcast,callin`). The segment
kind, the clock band kind and the topic kind are all `syndicated`; `isSyndicatedKind` is the one
predicate the planner, the scheduler and the clock read. The plugin and the module keep "podcast",
because that is what an operator subscribes to.

## The plugin describes, the station remembers

**`deadair.podcast_episodes` is the station's table and not anything a plugin keeps**, because every
column past the description is a fact about the station: the segment holding its copy, the fetch
bookkeeping, the aired mark. A plugin asked to remember that would hold station state where a
reinstall loses it.

**A refresh is an upsert that can only describe.** `PodcastEpisodeRepository.record` writes what a feed
may say (titles, summary, the audio address, the publisher's length) and its update set holds none of
the columns that say what the station did; `PodcastEpisodeListing` has no field for any of them, and
the SQL test pins it. "New" is read from `xmax` in the same statement, so two racing refreshes cannot
both call an episode new. Rows are kept when a feed stops listing them: an episode that aired last
month has not stopped having aired.

**Episode ids are a de-duplication contract** on the capability, `news.ts`'s rule, because the station
remembers episodes by them. `parseFeed` keeps it: guid, then Atom id, then link, then a hash.

**A show's id is derived from its feed address** (`showIdFor` in `plugins/podcast`). A band names a
show by it, so it must survive a rename and a reorder. The name, which is what `plugins/rss` uses, is
exactly what an operator edits. The host mints a row id only for a list holding a credential
(`plugin.config.rows.ts` argues why), and a feed list holds none.

**`itunes:title` beside `<title>` dropped every episode, until `text()` read an array.** With
`removeNSPrefix` the two are one element name, so the parser handed over an array and the text reader
answered nothing for it. Measured on NPR's Planet Money feed: 355 entries and none read. The first
readable member is taken now.

## Fetching the audio

**The fetch is the pad door's shape plus one check** (`PodcastFetchService`). The pad door has no
allowlist because an operator typed the address of their own air horn. An enclosure's address is
written by a feed's publisher, and a public name can point at this machine, which would put the
anonymous routes or the analysis sidecar on the mount. So redirects are followed by hand and every
hop's name is resolved and refused if any address it answers with is private (`privateAddressBehind`,
the `network.open` guard), with that guard's own gap: rebinding between the check and the connection.
The cost is that a podcast hosted on the operator's own network is refused.

**What the file is comes from its bytes** (`sniffSegmentExtension`). The extension decides the served
type, and Liquidsoap picks its decoder from that, so a wrong one airs as silence. A publisher's type is
whatever their CMS wrote, and `audio/x-m4a`, `audio/mp3` and an empty string are ordinary. Raw ADTS AAC
begins with an MP3 frame's sync word and is told apart by its layer bits, then refused: it is neither
an MP3 nor in an MP4 container.

**The body streams into `SegmentStore.writeStream`**, under a 256 MiB ceiling and a 64 KiB floor, both
enforced inside the stream so a refused body leaves no file. The ceiling counts bytes received, never
`content-length`: measured on an NPR episode on 2026-09-15, the file was 31.8 MB against the 28.0 MB
its feed declared, so a declared size is only ever a claim. The same episode took four redirects
through three analytics prefixes. `shared/bounded.body.ts` is the counting both doors now share.

**No inbox copy.** The inbox is there so a backup carries what cannot be made again, and an episode
can be fetched again. The price is on the list below: after a restore a syndicated segment's row can
outlive its file, and nothing yet notices.

**Every fetch is claimed on the episode row** (`claimFetch`): one conditional update moves
`fetch_requested_at` forward only for an episode not held and not asked for within
`FETCH_RETRY_AFTER_MS`. A scheduler running every commit pass, an operator pressing the button twice
and a restart mid-download all come down to one download, and a fetch that died without a word ages
out rather than sticking. Three automatic failures and the scheduler stops asking; an operator can
still ask.

## On the format clock

**A band carries the show's newest episode, and nothing if that has aired** (`SyndicatedSource`, over
`PodcastEpisodeRepository.newest`). Never back through the catalogue, which is what carrying a
programme means: a band at nine is where tonight's episode goes. A topic that names no show, a show
with nothing new, and an episode not fetched all decline, on `BulletinSource`'s argument that silence is
a state an operator can see and the wrong programme is not. The planner and the scheduler ask this one
question, so the episode fetched for nine is the one placed at nine.

**The audio is fetched three hours ahead** (`PodcastScheduler.ripen`, beside `ProductionScheduler.ripen`
on the commit pass), `COMMISSION_AHEAD_MS`'s number and asymmetry.

**Programmes are planted first, and everything else is planned against the order with them in it.**
Planned in one walk with the other bands, a bulletin meant for 10:45 was claimed against the order as
it stood before the hour went in, and would have aired at 11:45. The test that caught it is in
`break.planner.test.ts`.

**An episode is placed with the length its publisher states**, as `durationMs` on the lineup's segment
item, and `lengthOf` counts it. Without it an hour projected as nothing and every band behind it landed
an hour early, or past `BAND_LATENESS_MS`, nowhere. It is the second field of a segment safe to copy
onto the item, on `segmentKind`'s argument: set once, never changed. The stored document keeps it
across a restart. A stitched production carries it the same way now, through `insertGroup`'s
`GroupMember`: it had the identical defect for as long as a block went in as bare ids, and the length
there comes from the mixer rather than from a publisher, so it is measured rather than claimed.

**A programme is not a break for the rule that keeps two out of one gap**, on either side. A programme
beside a talk break is a presenter around it, and the news at the top of the hour a programme ends on
is where the news goes. A band due while a programme plays has no boundary near its time and is passed
over, which is right and is what any long item does.

**A programme is carried with `rules.breaks` off**, which switches off the station talking and says
nothing about a scheduled show. It costs the band read on a station with its breaks off, which the
production scheduler already makes.

## On air

**`RundownItem.programme` carries the three things about an episode that differ from the station's own
voice**, and everything else treats it as a segment: never faded into, the speech compressor, out of
history and scrobbling, and the empty `artist` that keeps it out of the song key space.

- **The mount names the episode and the show**, as it names a record, where a break shows the station's
  name. `listenerTitle` and `programmeRundownTrack`.
- **`/nowplaying` reports it as `record`.** The enum stays two arms because every listener app switches
  on `break`, and `record` is the arm that means "this has its own title and artist".
- **Its gain assumes a mastered level.** `speechGainFor` assumes -26.5 LUFS for anything unmeasured,
  which is the station's speech engine; applied to a podcast at -16 it added 11.5 dB, for an hour, into
  the limiter. `programmeGainFor` assumes -16 and keeps the speech trim, since spoken word belongs a
  little under the music.

**The aired mark is written on the aired edge** (`DirectorService.remember`), keeping the first airing,
and is what stops the band carrying the episode again tomorrow.

## The presenter around it

**A talk break is planted in front of every programme**, when the station's breaks are on and something
can write and speak one (`BreakPlanner.introduce`). Left to the spacing floor an introduction happened
only when a break fell on the boundary.

**A break beside a programme is shown it as a neighbour** (`WriteBreakJob.neighboursOf`), with the
episode as the title and the show as the artist. So the floor's phrasings read the way a presenter
talks, `mustNameRecord` still applies, and the claim guard still drops a "coming up" whose programme
has left the order. `BreakTrack.programme` is what tells a model it is a programme: the prompt heads it
"The programme" and describes a show and an episode with the publisher's summary, since a model shown
an `Artist` line says "a track from".

## Subscribing from the console

**There is no subscribe route.** The console reads the plugin's settings fresh, appends a row to its
`list` field with a `url` column (the rule the host's allowlist already uses to find a plugin's feed
addresses) and saves through the ordinary partial settings save, so the plugin's own schema judges it
and the plugin reinitializes. The directory search is `GET /podcasts/search`, on `platform.manage`
because the words go to somebody else's directory, and nothing is sent until somebody presses search.

## What is not built

- **The segment audio route reads the whole file into memory.** `getSegmentAudio` answers a `Buffer`,
  so an 80 MB episode is 80 MB of heap per fetch of it. A streamed body is a contract change.
- **An episode is never measured.** The sidecar decodes 30 minutes at most, so the gain rests on the
  assumed level. A streaming loudness pass would make it a measurement.
- **Only the newest episode.** A serial worked through in order, oldest first, would be an option on
  the topic, and the table already keeps what it would need. `narration_pieces` does exactly that for
  the things the station reads ITSELF (`narrations.md`), so the shape is written down; what is not
  built is bringing it back here, where the question is which episode of somebody else's show to air.
- **Nothing removes an aired episode's audio.** The segment store grows by an episode per airing.
- **PodcastIndex**, the other directory worth having, needs a key and is a second plugin row.
- **A podcast on the operator's own network** is refused by the private-address check.
- **After a restore, an episode's row can outlive its file**, since the backup carries the segment inbox
  and an episode never enters it. Nothing re-fetches a held episode whose file is gone.
