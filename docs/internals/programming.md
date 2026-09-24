# Internals: what the station plays

How records are chosen: the generator chain, the operator's opinion, the content policy, and the one
step every pick from every source passes through. The running ORDER those picks land in is
[`director.md`](director.md).

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## How a pick is made

**What the station PLAYS has several generators too, and that chain tops up rather than falling through.**
`SetGeneratorChain` is registration order as preference order, exactly like the writer registry
(`ModelSetGenerator` in front, `CatalogSetGenerator` behind it, `llm.setGenerator` off by default). The one
difference is load-bearing: a break is one sentence and is all-or-nothing, so the writer registry takes the
first answer and stops, but a set is `count` picks and a model that named six of fifteen has done most of the
job. So each binding is asked for what is still MISSING and the floor finishes the rest, which is why a
partial answer is kept rather than discarded. Songs already chosen thread down as `avoidSongKeys`; artists
deliberately do NOT, because excluding every artist already queued starves a long rotation of its own library
— an artist is spaced within a batch and cooled down once they actually air, which are the two places it can
be judged against something real.

**The floor cannot fail**, so keep it last. The ONE thing that suspends that guarantee is
`rotation.briefOnly`, off by default: with it on, a generator declaring `SetGenerator.ignoresBrief` (only
`CatalogSetGenerator` does) is not asked while a brief is in force, so a station told "flamenco guitar" runs
short rather than finishing the hour with whatever else the library holds. Three bounds make that safe to have
at all — it applies only where there IS a brief, since an unbriefed station's floor is not a mismatch but the
station itself; the similarity binding is deliberately NOT marked, because its seeds are records that actually
aired and so it draws from the brief's own results (**that argument does NOT stretch to a PERIOD**, and both
middle bindings filter on one themselves — see the period rule in `director.md`); and a refill it actually
cost records says so on the activity feed, because a station that ran dry with a full library is otherwise two
facts with nothing connecting them.

**A pick is judged where it becomes a track, never inside the generator that named it.** A `SetGenerator` pick is a NAME, so any binding that is not the catalog draw hands over titles nothing has judged, and a dislike is an INSTRUCTION no lineup may turn off, so a generator able to route around it airs a record the operator forbade. The rules therefore run in `PickResolver.resolve(picks, rules)`, the one step every pick from every source passes through. `CatalogSetGenerator` still filters before its own draw and that is NOT redundancy: filtering early keeps the draw from spending its weight on candidates that cannot air, filtering at the resolver makes the rules true for a generator that never read the catalog, and neither is safe to delete because the other exists. `applyRules` composes the four that decide whether a candidate may air; `spaceArtists` runs last and separately, because a batch spaced before its unplayable tracks are dropped closes the gap back up and puts one artist back on its own heels. The album cap (`rotation.maxPerAlbum`, `capPerAlbum`) is one BATCH's worth of variety, same as the per-artist cap beside it. Nothing here stops the record after it from picking the same release again, which is the cross-batch seam `avoidArtistKeys` already closes for artists and a release has not needed yet.

**Smart shuffle is a lean on the draw, never a filter, and it is keyed on the song.** The repeat window and the artist cooldown are filters, and a filter has nothing to say about the far side of itself: past the window, a record aired four days ago and one never aired were drawn with identical probability, which is the bubble [station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §5 names. `rotation.smartShuffle` (on by default) stamps each sampled candidate with a `freshness` from `0` (just aired) to `1` (a `rotation.smartShuffleDays` horizon ago, a fortnight by default, or never), read from `PlayHistoryRepository.lastAiredSince` grouped by `song_key`, so a discovered copy of a record that aired yesterday is exactly as stale as the copy that aired. `weightOf` multiplies it in beside the like-doubling, from `FRESH_FLOOR` (a quarter) up to full weight. **Never zero**, because a weight of nothing is a second repeat window nobody set, and a library of forty records must still play all forty. Three limits worth knowing before anyone extends it. It chooses only among what `CandidatesRepository.sample` drew, which is enough because the sample is random; if it ever has to hold for the whole library in one batch, the fix is ordering the SQL by a randomised function of age rather than raising the ceiling. It is bounded by the history's 120-day retention, which is why the horizon's ceiling is that figure. And a generator that NAMES records cannot be weighted, only judged, so the lean reaches the named sources where they choose rather than at the resolver. `SimilarSetGenerator` takes the freshest of each neighbour's few top tracks, ties to the source's own ranking, instead of always the first: a neighbour's first track is the same record every time that neighbour comes up, and on the live station the fortnight's most-aired records (2026-09-12) were exactly those canonical hits, five to seven airings each. `ModelSetGenerator` cannot be leaned at all, since the model does the choosing, so it is TOLD instead: the refill reads the same history into the scoped `AiredRecords` and `MusicSearchTool` marks each row with `airedDaysAgo`, the shape `queued` already has and for the same reason (a fact the host holds must not become a question the model spends a step on). Information, never a veto: a narrow brief may need the record that aired yesterday, and refusing it is the repeat window's job. Off asks the history for zero days, which runs no query and restores the old draw, the old walk and the old search rows exactly.

**Several similarity sources are asked in an order the operator sets, and the order matters to two of the three questions rather than all three.** `SimilarityService` pools every source for `similarTo` — two sources disagreeing about who resembles Portishead are two opinions, not a conflict — so the order there only decides whose ids survive when both name the same artist. `topTracks` and `similarTracks` take the FIRST usable answer and stop, so for those it decides whose judgement airs. Until `rotation.similarityOrder` that order was `record.id.localeCompare`, which on a station running all three bundled sources means `deadair.deezer`, then `deadair.lastfm`, then `deadair.musicbrainz`: an accident of spelling, and nothing an operator who trusted one source over another could change short of disabling the others. The setting is a `list` of plugin ids, and it is now one of six that share the same machinery: `plugins/plugin.order.ts` reads any of them with `pluginOrder` and sorts with `byOrderThen`, which puts the listed ones first in the order given and leaves everything else to the capability's own fallback — alphabetical here — so **an empty setting is exactly the old behaviour**. Which key belongs to which capability is one row of `plugins/plugin.providers.ts`, and `SimilarityService.plugins()` reaches its sources through `pluginsInOrder` over that row rather than composing the sort itself. It orders and never gates: an id that is listed but not installed is absent rather than an error, and a source left out is asked after the listed ones rather than switched off — a setting that could silently disable the only similarity plugin would turn a typo into a station with no discovery. `SimilarityService` is scoped, so the setting is read once per refill and a change applies at the next one; the day-long cache holds merged neighbours rather than the order, so nothing needs invalidating.

**A playlist can ask for its neighbours to be mixed in, and they are seeded from the playlist, never from what aired.** Spotify's Smart Shuffle is a playlist with recommendations among it, and nothing here did that: the similar share of a refill only starts once a playlist runs out. `PutOnAirInput.mixInSimilar` (or `rotation.mixInSimilar`, off by default on the chart mix's argument: a playlist is what the operator chose) rides the broadcast's `rules`, and after the put-on-air commit the director sends one `director.mix_in_similar` job. `MixInSimilarJob` takes every `rotation.mixInEvery`-th planned record as an ANCHOR (four by default, at most `MAX_MIX_INS`), asks `SimilarPicker.pickLike` for one record like each anchor (the record-level `similarTracks` first, where a plugin implements it, then the anchor's artist through the same walk `SimilarSetGenerator` runs, lifted out of it for this), resolves the lot once through `PickResolver.resolve` with the broadcast's rules, and posts one `interleaveTracks` command naming each record's anchor. Three things are load-bearing. **The seed is the anchor, not the history**: at the moment a playlist goes on air the history is entirely the previous programme, which is the "Mitch Murder opened on thirteen thrash records" failure `SimilarSetGenerator.seeds` records. **Only a rotation mixes**: `resolveRules` ties the switch to `mayGenerate`, so a setlist or a feature refuses it whatever it asks, unlike crossfade, which a setlist may ask for; and a chart is excluded at the send, being somebody else's published document. **A pick that comes back from the resolver under a different name is dropped**, because the anchor is matched by song key and a guess would put a record after the wrong line. An operator who asked and got nothing is told: `order.mixInEmpty` on the feed, with no similarity plugin or with every pick refused.

**A playlist put on air is a source, not a generator, and the instruction still applies to it.** `DirectorConsoleService.putOnAir` never names a `SetGenerator`, so it cannot go through `resolve` — and it must not, since `resolve` respaces a batch and overwrites title and artist from the catalog row, and a playlist's order and strings are the operator's own. `PickResolver.vet(tracks, { era, preference })` is the narrower method for exactly this: order-preserving, no rewritten strings, and built from the same `rejectDisliked`, `withinPeriod` and `bindingsFor` calls `resolve` makes, so a dislike, a period and the advisory policy hold for a track that arrived on a playlist exactly as they do for one a generator picked.

**A pick the catalog has never seen is looked up at a provider and INGESTED, and the order of that against the
rules is load-bearing.** The library holds what the account's playlists carry, because playlists are the only
enumeration a provider offers, so a perfectly good pick outside them used to be dropped.
`PickResolver.identify` now falls to `ProviderTrackLookup`, and a hit becomes a real `deadair.tracks` row with
a binding — it has to, because the player fetches every record through `track_sources`, so a copy with no
binding has no URL. The lookup is STRICT (normalized title and lead artist must both match exactly; duration
only breaks a tie), because a near-miss does not error, it airs the wrong record while the console says
otherwise. It is bounded per resolve (`MAX_DISCOVERIES`, counted as attempts) since every miss searches every
provider, and gated by `rotation.discover`, on by default because off makes the path inert.

**Ingest happens BEFORE the rules run**, which is what makes a newly ingested record by a disliked artist get
dropped rather than aired for want of an opinion. The other half is `track_sources.origin`: the sync's
`markMissingTrackSources` only judges `origin = 'sync'`, because the sweep is an argument about what a
playlist WALK saw and a discovered copy is in no playlist — without it the first sync after a discovery
benched everything the station found for itself. A walk that later sees a discovered copy moves it into the
sweep; a lookup never moves a synced one out. What judges a discovered copy instead is fetching it, via the
four-failure bench in `TrackAudioService`.

**The walk starts three ways, and only one of them is judged by the schedule.** `catalog.sync` fires on an
hourly cron that never changes; `CatalogSyncJob` recognises that run by its payload having no keys (pg-boss
delivers a cron run's payload as `null`) and returns early when `catalog.autoSync` is off or the hour is not
a multiple of `catalog.syncEveryHours`, counted from the epoch in UTC, so "due" needs no record of the last
run and a retry inside the hour is still due. The other two are SENT and always run: a provider's settings
saved (`{ pluginId }`) and an operator's refresh (`POST /playlists/refresh`, `{ requestedBy: 'operator' }`).
That is why every sender carries a key: a send of `{}` would be read as the schedule and could be skipped.
Only an operator's walk goes on the activity feed, as one `sync.finished` entry, because the button can only
answer "queued" and somebody is waiting to learn it finished.

**A walk of one playlist ingests and never sweeps.** `POST /playlists/{pluginId}/{playlistId}/refresh` sends
`{ pluginId, playlistId, requestedBy }` and `CatalogSyncService.syncPlaylist` reads that playlist's tracks
alone. The sweep above is an argument about what a walk of EVERYTHING a plugin offers saw, so swept against
one playlist every other record from that provider would read as gone, or the proportional guard would
refuse every time and warn the operator about a walk that did nothing wrong. A record taken out of that
playlist stays until the next whole walk judges it. A hidden playlist is refused, 409 at the route and
`hidden` in the walk, on the rule that hiding one takes it out of the library.

**A station playlist is a clone, and every way in is one list of entries.** `deadair.playlists` sat empty from
0005 until import existed; now a file (`playlist.file.ts`, keyed by words and ISRC and never by this
station's ids, per [backup-and-restore](https://github.com/robert-dean/deadair/discussions/6)), a text list
(`playlist.text.parser.ts`: M3U by its `#EXTINF` lines, CSV by header name, `Artist - Title` lines), a pasted
link and a provider playlist the station lists all become the same entries, and `PlaylistImportPlanner` is
the one thing that decides what they would be here. The preview and the import both run it, so the preview is
the decision rather than a forecast of it. It only LOOKS: `findTrackSource` for an entry that names a
provider's copy, then `findTrack` on the resolver's own keys, and nothing is searched or ingested while an
operator waits on a preview. Every entry becomes a row, in its place: a match, or a placeholder carrying its
snapshot, and since 0047 a placeholder may be a snapshot with no provider id at all, because a line from a
file names a record and no copy of it. Refusing that row would lose the record and its position, which is
the lossy import 0005 was written against.

**Filling a placeholder is discovery, run as a job rather than in the request.** `playlists.fill` is sent
after an import that left placeholders and by the page's button, and `PlaylistFillService` walks a ladder
that is cheapest and most exact first: the library again, then the provider copy the row was cloned from,
asked for by id (the only way a file from another station's Spotify lands on the same recording here), and
then `ProviderTrackLookup.find`, the strict search `PickResolver.discover` already trusts. A hit is ingested
as `discovered`, for the reason the paragraph above gives. It is gated on `rotation.discover`, because that
switch is the station's one answer to "may it add records to its own library", and it is bounded per run
(`MAX_FILL_LOOKUPS`) because every miss searches every provider one after another. It is a `PlainJob`
because it talks to providers between writes. What it misses stays a placeholder, and
`catalog.resolve_placeholders` matches it whenever a sync grows the library.

**A link is claimed by the provider it belongs to.** `MusicProviderCatalog.playlistIdFromUrl` is an
optional PURE parse; the import asks every catalog provider in id order and the first to claim a link wins,
which is why a provider claims only what it is sure of (Navidrome only a link into its own configured server).
It is called directly rather than through the invoker, since a throw there is a bug in a string function
and must not count toward quarantine the way a failed upstream call does. The tracks are then read through
`PlaylistsService.getPlaylistTracks`, so the access narrowing and Spotify's refused-playlist fallback both
apply exactly as they do when the console lists one.

## The station's opinion, and the policy over it

**An opinion is held at three levels and inherits DOWNWARD in both directions.** `artists`, `albums` and `tracks` each carry a `rating` of `-1 / 0 / 1`, written from the console through `PUT /catalog/{artists,albums,tracks}/{id}/rating` (`platform.manage`; the wire spells it `liked / neutral / disliked` and `catalog/rating.ts` is the only place that meets the column, because the ORDERING is what the SQL below needs and nothing outside the database reads it as a number). `CandidatesRepository.effectiveRating` is the one expression that collapses the three into one, and it is **not** a `least()`: a dislike anywhere wins outright, because a dislike is an instruction no lineup may turn off, and otherwise the strongest LIKE carries, because liking an artist means play more of them and liking one song means play that song more. It was a plain `least()` for as long as it existed, which got the veto right and silently swallowed the other half — a liked song on an unrated record by an unrated artist came out `0`, so `weightOf` doubled nothing an operator could produce without rating all three levels identically, and liking a record did nothing whatsoever. Both `sample` and `ratingsFor` go through it so the draw and the resolver cannot disagree. Nothing unit-tests it, since it is SQL: `apps/api/scripts/rating.smoke.ts` is what covers it, against the real database.

**A dislike also reaches a running order that is ALREADY BUILT, which for a long time it did not.** The two
places above — the draw's own SQL and `PickResolver.resolve` / `vet` — are both places a running order is
BUILT, and a lineup is then a stored list of items walked by state, with `StationLineup.nextPlanned` reading no
rating at all. Measured on the live station on 17 September: it went on air at 07:32 from an imported playlist,
so every record on it was vetted at that instant; the operator disliked an artist at 08:23; two of that
artist's records aired at 09:10 and 10:44 and two more were still `planned` hours later. Nothing was broken —
the rating was written and every later DRAW honoured it — the order simply never asked again. `CatalogModule`
is registered before `DirectorModule`, so the fix is the backwards edge `StationBus` exists for: the catalog
publishes `catalog.disliked` from an `AfterCommit` hook (published inline, the subscriber's read answers with
the row as it stood BEFORE the write, which is the original bug with a mechanism in front of it), and
`DislikeVeto` forwards to `DirectorConsoleService.vetoDisliked`. That **re-judges the whole remaining order
through `ratingsFor` rather than resolving what was rated to a track list**, which is not a shortcut: it is the
same expression the draw uses, so a disliked artist GUESTING on a record is caught here exactly as it is at the
draw, where matching on the lineup's own `RundownItem.artist` would have seen the lead and only the lead. A
line whose `trackId` the catalog does not hold is KEPT, which is `vet`'s own answer at the same fork. The edit
goes through `StationLineup.remove`, so a forbidden break is marked rather than spliced and a forbidden beat
takes its production with it; a record the player is holding is marked `skipped` and the queue retracted; and
the record ON AIR is cut where it stands, in the two fixed halves a skip to a record already uses — the order
inside the mailbox, `PlayoutPusher.skipCurrent` outside it, because the cut waits out a boundary. A refill is
re-armed and `reopenPromises` rewrites a break that promised one of the departed records, both of which
`DirectorService.thin` was already doing for the record that cannot be fetched.

**An advisory is a LABEL on a COPY, and the policy over it is not a rotation rule.** `track_sources.advisory`
is `explicit` / `clean` / null, per BINDING rather than per track because a clean edit and the explicit
original collapse to one `deadair.tracks` row (`resolveTrack` matches on `title_key` + artist and the edit's
own ISRC misses) and stay two copies — the binding IS the version, so `rotation.advisory` (`prefer-explicit` /
`prefer-clean` / `clean-only`) is almost entirely binding selection in `CandidatesRepository.bindingsFor`, and
a work left with no eligible binding falls into the existing "nothing can play this" drop rather than a second
mechanism. Four things are load-bearing. It is named for the LABEL and not the words — nothing here reads a
lyric, Spotify is passing on a marking — so **`lyrics` stays reserved for the text**, which
[track-lyrics](https://github.com/robert-dean/deadair/discussions/47) wants for a thing the station may read and never say; `content_rating` was
rejected because `tracks.rating` already means the operator's `-1/0/1` opinion. It is read at the point of use
and deliberately **not on `ResolvedRules`**, because `NO_RULES` zeroes that bag and a setlist — whose whole
mechanism is starting from the rules off — would silently begin swearing; it follows `rejectDisliked` instead.
The advisory **outranks the operator's provider preference**, since the policy is a rule about content and the
provider list is a preference about delivery, and ranked the other way a `prefer-clean` station whose clean
copy sits on the second-choice provider is handed the explicit one from the first with nothing saying why. And
`clean-only` demands a **positive `clean`**: most providers never mark anything, so a library from one of them
plays nothing, which is the honest answer and is paid for in the setting's help text and in `AdvisoryWatch` —
it tells that state apart from an empty catalog by asking the same draw again with the policy off, and writes
one `station_events` row on the edge. The presenter side is separate and asymmetric on purpose: `speaksClean`
is true for BOTH non-default states, because a preference is only a lean about which copy to play when there
is a clean twin to choose, and a presenter always has the choice of their own words. Nothing checks the
model's answer against it. `apps/api/scripts/advisory.smoke.ts` covers the SQL.

**The operator's own account-level explicit filter is reported and never enforced** — the plugin reads
`explicit_content.filter_enabled` and `filter_locked` off a profile call it already makes — because the audio
comes through the shim rather than the Web API and whether that filter binds on the fetch path is unmeasured;
see [clean-copy-matching](https://github.com/robert-dean/deadair/discussions/9), which also holds the deferred matcher for a clean copy the playlists
never carried.

## What the model is offered

**ONE search tool, because the split between two was a decision the host could make itself.**
`MusicSearchTool` (`search_music`) reads `deadair.tracks` and fans out over the provider plugins in one
answer, and every row carries `owned`. It was two tools — `search_library` and `search_catalog` — and choosing
wrongly used to be silent and fatal, because a provider pick matched no catalog row and was dropped.
`PickResolver`'s lookup rung ended that, and in ending it turned the split into a PREFERENCE the model had to
arbitrate on every call using no information the host lacks. That arbitration is where briefed refills died:
told to search the library first and reach past it only when it could not fill the ask, a model briefed
`artists like mitch murder` against a library of rock and metal searched the LIBRARY for one synthwave
neighbour after another, got nothing every time, and ran out of tool steps before it answered. So the
preference is now a field rather than a choice: an owned record is catalogued, bound, usually on disk and
measured, and an unowned one is fetched when it is chosen. Four things are load-bearing.

**`ownership` matches the resolver's own keys** (`title_key` + `artist_key`, the same ones
`CandidatesRepository.findByName` uses), because `owned` has to be the claim `PickResolver.identify` will act
on rather than a looser one that reads as free and costs a download.

**Bans narrow BOTH halves now** — `dislikedArtistKeys` is a second read precisely because a provider row by a
banned artist joins to no catalog row and the first cannot see it — while **rotation rules still narrow
neither**, since variety is enforced at the point of choice and pre-filtering returns a worse pool on a small
library.

**The providers are reached only when the library comes up short** (`THIN`), or always if the operator sets
`llm.alwaysSearchProviders`; the default is not merely thrift, because break writers share this tool and
theirs check a record already in the catalog, so under the default a break write never waits on a provider.

And **`OWNED_SHARE` reserves room for the provider half**, or a brief the library HALF matches fills the
answer with owned records and the failure moves from the model's choice into the ordering. A second tool,
`StationTasteTool` (`station_taste`), answers what the operator has liked and disliked; it reports and never
enforces, and `ModelSetGenerator` also puts a short version straight in its prompt so a model that cannot
drive tools still gets the steer.

**The search answers with the LEAD artist, never a credit line, and that is a correctness rule rather than a formatting one.** The model is told to copy a title and artist back exactly, because `ProviderTrackLookup` is strict — and the two steps that then judge the pick both match on the lead artist alone: `PickResolver.identify` keys it off the MATCHED ROW's title and lead (`songKey(found.title, [found.artist])`, so the keys are the ones `play_history` will be written with rather than the words that went looking) and the lookup compares `normalizeKey(track.artists[0])`. The provider fan-out answered `artists.join(', ')` for as long as it existed, so every collaboration it returned was named correctly by the model and then dropped as "not in the catalog" — a live run resolved every solo credit and lost every duet. The other credits ride in `featuring`, which is shown and never copied. Anything new that hands a model a record to name owes the same shape. The related bound is that it must offer enough rows to fill an OVERSAMPLED batch (`MAX_RESULTS` is 25): a model shown ten records and asked for two dozen pads the answer with repeats, `SetGeneratorChain` discards them, and `CatalogSetGenerator` — which cannot act on a brief — quietly fills half the hour.

**An item's `artists` is a display credit and its `artist` is the identity, and nothing may take one for the
other.** `RundownTrack.artists` is a list because a provider gives one, but half the producers only ever have
the credit as a single string: an item built from a playlist holds `['USHER','Lil Jon','Ludacris']` and one
`PickResolver` resolved holds `['USHER, Lil Jon, Ludacris']`. So `artists[0]` is the lead only by luck, which
is why `artist` exists beside it and why every key comes off that — `play_history`, `songKeysOf` (the
generator's avoid list) and the scrobbler. It was `artists[0]` in all three for as long as they existed, so
the writer stored `drake wizkid kyla` as one artist while every reader asked about `drake`: no repeat window
or artist cooldown could match a collaboration, and Last.fm was sent a credit line as an artist name.

**Nothing showed** — the only symptom of a rotation rule that never matches is a station that repeats itself,
which is the failure `rotation.keys.ts` opens by warning about. `PickResolver` fills `artist` from the catalog
row it MATCHED (or the provider row it just ingested), never from the pick that went looking, so the keys a
record is judged by are the ones it will air under.
