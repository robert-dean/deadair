# Internals: reading somebody else's writing out

How the station airs a chapter of a book, an issue of a newsletter or a long read: the capability,
the table that remembers what the station did with each piece, the production that is written before
it starts, the format clock, and what a reading is on air. What a PRODUCED programme is (a `podcast`
band the station writes and speaks) is [`productions.md`](productions.md); carrying an episode
somebody else recorded is [`podcasts.md`](podcasts.md). This is the third thing.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## The pair it completes

**The station has two text sources, and the line between them is what it DOES with the words rather
than where they came from.** A `news` plugin hands over entries and the station talks ABOUT them: what
airs is a sentence a model wrote. A `narration` plugin hands over pieces and the station READS one,
verbatim, as a programme. Reading it out is the whole programme, and no model writes a word of it.

So the question to ask of a source is not what it publishes but whether its words are meant to be
heard as they stand. A headline is not, and a chapter is. A source whose text would need summarising
is a `news` source even if it publishes books, and one whose text is meant to be spoken whole belongs
here even if it publishes news.

**It is a third capability rather than a mode on `podcast`, because the audio comes from somewhere
else entirely.** A podcast plugin names an ADDRESS and the host fetches what somebody else recorded;
here the station makes the audio itself, which is what earns a chapter everything the station's own
voice gets: the pronunciation lexicon, the performance cue strip, the presenter's voice, and a
loudness measurement rather than the assumed level a fetched episode is given. It can afford to hand
over the content itself for the same reason: a chapter is kilobytes where an episode is a hundred
megabytes, so `getText` fits inside `host.fetch`'s body bounds with room to spare.

**A plugin must never synthesise**, and the capability has no way for it to. Speech is selected by
the operator (`render.speechPluginId`), and the station holds exactly one engine slot: a second
source producing audio on its own schedule would compete with the presenter for the card and would
arrive having skipped every stage above.

**A text part is an OBJECT and not a string** (`NarrationPart`), which is the one shape here chosen
for a future rather than a present. Everything today needs only `text`. The next thing anybody will
want is more than one voice in a piece (a play, a dialogue, a letters page), and that wants a `role`
beside the words. Adding a field to an object is a change every plugin already written survives;
replacing a `string` with an object is not.

## The plugin describes, the station remembers

**`deadair.narration_pieces` is `podcast_episodes`' argument one capability over**: every column past
the description is a fact about the station, so `record` is an upsert whose update set holds only
what a plugin may say, and `NarrationPieceListing` has no field for any of the rest. The SQL test
pins it by splitting the compiled statement on `do update set`.

**It costs more here than it does for a podcast if that breaks.** A re-listed episode that lost its
fetch mark is a second download. A re-listed piece that lost its render mark is the station's only
speech engine spending minutes saying a chapter it has already said, and then airing it twice.

**What the row tracks is a PRODUCTION, not a download.** `production_id` while the piece is being
spoken, `segment_id` once the joined audio exists. That is also why `claimRender` guards on
`production_id is null` where `claimFetch` has no equivalent: without it, a claim taken while a
production was already being written would open a second one.

**A series' order is denormalised onto every piece** (`series_order`). The one question every read of
this table asks is "what is next for this series", and a series table nothing else needs would exist
only to answer it. Free text with no check, on `segments.kind`'s rule, and read leniently: anything
that is not `latest` is a serial. That is the safer of the two to be wrong about: a serial reads
something the station has not read, where a `latest` could decline forever on a series with no dates.

## Two orders, and they are different questions

**`nextFor` has two arms and they do not fold into one query with the sort flipped.**

- A `serial` takes the lowest `ordinal` not yet aired, and deliberately DOES reach back: a chapter
  published years ago is next if the station has not read it. The station's place in a book is
  `aired_at`, not the calendar.
- A `latest` takes the newest dated piece and answers nothing once it has aired, never reaching into
  the archive. That is `PodcastEpisodeRepository.newest` exactly, and it is what carrying a column
  means: a band at ten is where tonight's issue goes, and on a night nothing was published the
  station does not read last week's instead.

**A `narration` band REQUIRES its series**, unlike a `syndicated` band, which with no topic carries
the newest episode of any show. There is no such answer here: "the next piece of any series" would
read chapter four of one book and then chapter one of another.

## The production that is written before it starts

**A piece is a production opened directly at `rendering`, with every beat born `written`.** That is
the whole mechanism and it needed no new render path: `SegmentRepository.plan` starts anything handed
a script at `written`, so the beats are claimable by `RenderSegmentJob` immediately, and
`DirectorService.injectProductions` already notices a production whose beats are all `ready` and asks
the mixer to join them. No model is called at any point, because the author did the writing.

**It opens through `ProductionRepository.open`, never `ProductionsService.request`.** That one sends
`director.produce`, whose first pass claims the row `planned → drafting` and would write model beats
over the author's. `planned → rendering` is a transition nothing else in the tree makes, and it is
the whole difference between this and a production the station writes for itself.

**The narrator is the station's DEFAULT host, not whoever is presenting.** The render runs hours
ahead of the slot on whatever broadcast happens to be on at the time, so reading the presenter off
the current show would give chapter three one voice and chapter four another. A series has one
reader. A narrator field on the topic is the obvious next step and is not built.

**The beats are spoken at `background`.** A chapter is six to ten takes on the one engine, and at
`air` a break planted in the meantime queued behind every one of them at equal rank. The gate orders
by rank and never preempts, so a break in front of a backgrounded reading waits one part rather than
the whole chapter.

**`RENDER_AHEAD_MS` is six hours, twice the podcast window**, and the asymmetry is what the work IS:
fetching an episode is minutes of somebody else's bandwidth, where speaking a chapter is several
takes on the station's own engine, each yielding to everything the presenter needs.

## Collecting what has been spoken

**The attach lives in the scheduler's ripen pass, and that is the one piece of this with no obvious
home.** A podcast's fetch job writes the segment id onto its episode; a narration's audio arrives as
a production finished by the DIRECTOR, and nothing in that path knows what a narration piece is.
Reaching from the shared stitch job into this module would invert the module order for a case a pass
already running every commit can simply look at. So `NarrationScheduler.ripen` both asks for what the
clock will want and collects what is done.

**Attaching moves the production to `aired`, and that matters more than it looks.**
`ProductionRepository.unfinished` is capped at twenty and ordered oldest first, so readings parked in
it would eventually crowd out every phone-in waiting to be placed. Safe because the planner's own
`insert` sets no `groupId`, and `releaseUnheardProductions` only ever hands back a group.

**`injectProductions` stitches a reading and then leaves it.** An operator gave it a time, so it is
placed by the format clock like an episode rather than dropped into the next gap by
`slotForProduction`.

**The three ways a production ends badly are all written on the piece**, which is what lets it be
tried again: no mixer, a beat that could not be spoken, and an operator cancelling it.
`markRenderFailed` clears `production_id` as well as counting the attempt, because leaving it there
would wedge the piece forever behind a `claimRender` that can never win.

**A station with no mixer cannot air a reading at all.** A block of beats cannot ride a
single-segment answer, since the planner places one segment, so unlike a phone-in there is no "goes
in as its parts" fallback. The slot is declined with the reason on the row, on `BulletinSource`'s argument:
silence is a state an operator can see and the wrong programme is not.

## On the format clock

**`isCarriedKind` is the predicate every rule about programmes now reads**, and it answers yes for
`syndicated` and `narration` alike. The two arrive completely differently and every one of those
rules is indifferent to which: planted before everything else because the length moves every boundary
behind it, not a break so the two-in-one-gap rules do not apply on either side, and what a talk break
planted in front of it is about. What is NOT that question is which SOURCE fills the band, which is
the one place they differ and where `fillBand` dispatches on the kind itself.

**A reading is placed with a length or not at all.** The joined row's own measured duration where the
mixer reported one, and `word_count / 180 wpm` where it did not, 180 being an observation off Kokoro
reading a long piece rather than a specification. Never nothing: podcasts.md's "an hour projected as
nothing" is the same failure, and here it puts the news twenty minutes into a chapter.

**`JoinedSegment.context` is what makes the joined row recognisable as a programme.** A phone-in's
beats carry no context and nothing about them changed; a reading's do, and the stitch job copies the
first beat's onto the joined row. Without it `segmentRundownTrack` has no way to tell the row from
the station talking: the mount would name the station and the aired edge would never mark the piece
as read. `segment.source.ts` routes on `source === SYNDICATED_SOURCE || context.programme === true`
rather than on a kind, because `render` registers before `narrations` and reading this module's
predicate there would be a backward edge.

**The aired mark is also the station's place in the book.** `DirectorService.remember` calls both
programme repositories on the segment that played; each is keyed on `segment_id`, so one is always a
no-op for the other's rows, and one statement matching nothing is cheaper than asking first which
sort of programme it was. For a serial this is what stops the band reading chapter four forever.

## What is not built

- **A narrator field on the topic.** It needs a `station.personas` option source, which would be a
  fourth copy of a vocabulary that already has three.
- **Several voices in one piece.** `NarrationPart.role` is the shape it would take; nothing reads it.
- **Rewinding a serial**, which would be clearing `aired_at`. An operator re-adds the series for now.
- **Nothing removes an aired piece's audio.** The segment store grows by a piece per airing, exactly
  as it does per episode.
- **A plugin's `getText` is trusted to have stripped editorial furniture.** `[Illustration: …]` and
  `[Footnote 12]` reaching the speech path are read as performance cues and vanish, or worse make the
  presenter cough. The SDK says so twice; the host does not check.
