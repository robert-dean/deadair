# Internals: productions and callers

A programme that airs as a block in the middle of somebody's broadcast: who is cast, how long a turn
is, how the beats are joined, and what a caller may say that a presenter may not.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Casting, and what a caller may say

**Somebody can PHONE IN, and everything about that is decided host-side rather than by the model.**
`personas.kind` is `host` or `caller` — not null, defaulting to `host`, which is a correction to
`docs/todo/personas.md` §1: it sketched the column nullable with a `(station_key, kind)` unique index
"with nulls distinct", and nulls distinct is Postgres's default, so two null-kind rows would not
conflict and the station could have TWO active hosts. A caller can never be active at all, refused by
`personas_caller_inactive_check` as well as by `PersonasService.setActive`, and it ships with no
`templates` because phrasings are the STATION's floor under a break and a phone-in whose caller was
written by a template is a phone-in with nobody on the phone. Five callers seed, both speech plugins
map them, and the roster is five rather than six because the two shipped maps must name the SAME
slots and sharing a voice with a host is the one thing they may not do — the two are in one
programme talking to each other. A caller reaches a listener only inside a PRODUCTION
(`productions.casting`, decided by the first pass that runs rather than at commission, since the
clock reads three hours ahead and the roster can change in between), and there are three ways to ask
for one: an anchored clock band, the on-air page's own button, and a broadcast told to take them.
**All three commission through one path** and every one of them hands over the SHOW — a production
airs as a block in the middle of somebody's broadcast, and one that inherited neither its brief nor
its host is a phone-in about nothing in particular presented by the station's default persona rather
than by whoever's programme it interrupts. The standing one is `ResolvedRules.callins`, a
per-broadcast rule beside `breaks` rather than under it (a break is the station talking and a call is
a programme, so a station that wants a DJ has said nothing about wanting a phone-in) with its own
spacing for the same reason, and it is idempotent by TABLE READ in a fixed order: one unsettled
call-in for this broadcast means one is coming, and the spacing clock does not start until it AIRS,
so checking the spacing first would queue a switchboard. Six things are load-bearing.
**Who says a turn is arithmetic**: `OutlineBeat.lead` is deleted and `BeatPlan.speaker` replaced it,
on `production.plan.ts`'s own rule about how long a beat is — a model naming somebody the production
was not given is a turn drafted as one character and rendered in another's voice, silently — and the
outline is TOLD the assignment so it can plan content that fits. **A turn is not a beat**:
`TURN_BAND` is 15/30/60 against the monologue 150/200/260, because the monologue floor is argued as
"below this a beat is a headline read out", which is true of somebody talking uninterrupted and false
of somebody answering a question; a dialogue's turn count is forced ODD, since the host both opens
and closes. It was 40/70/110 and that was measured wrong: the model hit the budget exactly (58 to 78
words across every turn of every call) and seventy words is twenty-six seconds of uninterrupted
speech, so seven of them alternating is two people reading paragraphs at each other, which is what
"call-ins run long" actually was. **The budget is split by ROLE and not evenly** — `turnWeights` in
`production.cast.ts`, where role knowledge lives, handing `production.plan.ts` plain numbers so the
arithmetic learns nothing about who is on the programme — because a host asks and hands over where a
caller answers, and funding both identically is the same failure from the other side. Together a
three-minute call is fifteen turns of 23/43, which costs a model call and a render per turn: roughly
double, taken deliberately. **`TURNS_PER_CALLER` moves whenever `TURN_BAND` does, and nothing makes
that obvious** — it is a proxy for a caller's AIRTIME and was calibrated against seventy-word turns,
so the finer band left alone casts two callers into an eleven-turn call and three into a fifteen-turn
one, which is `MAX_CALLERS`' documented switchboard arriving through a door it does not cover.
**A caller may be WRONG and the host is what makes that safe**: the grounding block goes
out as fact, which is right for the station's own voice and wrong for a phone-in, so a caller whose
sheet carries a `latitude` gets a licence instead (what THEY think, kept theirs, never a real named
person, never anything shaped like news) and the host's next turn is told to take it as theirs rather
than confirm it — the licence REPLACES the ordinary rules rather than joining them, because two rules
that disagree produce neither. **A production beat is never recast alone**
(`SegmentRepository.recast` skips `production_id`), since a recast re-offers what the outgoing host
had lined up, which is right for a break and a hole in the middle of a programme for a beat, and a
caller differs from the incoming host by definition. **A caller ARRIVES mid-programme**, so
`firstTurn` is a fact about the SPEAKER rather than about the beat: it is the one place a greeting
belongs, `checkBeat` is excused there, and the prompt says which way round the call went because the
first live one opened with "thanks for calling", which is the presenter's line. **The host both puts
a caller ON air and takes them OFF**, which `openingRule` knew neither of: the opening beat was told
to set the programme up and nothing about anybody holding, so it wrote a music-hype monologue and the
caller simply appeared unintroduced, and the last beat matched no case at all and fell through to
"carry on from where the last beat left off", so the host closed the SHOW and left the caller on the
line. `guest` is a separate question from `previousSpeaker` and has to be, since the opening beat has
nobody before it; `lastTurn` is a fact about the BEAT, since a programme has one ending however many
people were on it. And **the estimate
that decides a cast is taken in the dialogue band** — the first live call-in of three minutes looked
like two monologue beats, below the floor for casting anybody, so the station made a phone-in with
nobody on it and nothing said why (`turnsFor`).

## Writing, then airing

**A beat is the unit of WRITING and the joined row is the unit of AIRING, and only the second half is
new.** A beat has to be its own segment because it is one model call in one voice, and it used to be
its own lineup item too — seven turns of a three-minute phone-in were seven items, seven hand-overs
to the player and seven metadata changes on the mount, with the pause between turns being the speech
engine's own padding plus whatever the transport added at the boundary, adjustable by nobody. Once
every beat is `ready` the director moves the production `rendering → stitching` and sends
`render.stitch_production`, which asks the mixer to trim each beat to its own cue points, join
them with `render.productionGapMs` between (200ms, clamped 0–2000) and hand back one file. That is
the only thing this buys that nothing else could: one title on the mount and one item to remove are
worth having and are not the reason. Five things are load-bearing. **Joining is its OWN capability
(`mixer`, `MixerProvider.join`, `analysis/README.md`'s `/join`), picked by its own key
(`render.mixerPluginId`), and the reason is not that the work differs from measuring.** It is the
same requirement seen from the other end — both need decoded PCM, which is the one thing that does
not happen in Node — so it is one sidecar and ONE PLUGIN declaring both, on the terms
`plugins/spotify` declares `catalog` and `stream`. It is two CAPABILITIES because a capability is
the unit of SELECTION: carried as an optional `joinAudio` on `analysis`, as it was for one commit,
the station's joiner is whichever plugin the operator chose to MEASURE with, so a second analyzer
that measures better and cannot join takes joining away and the only remedy is to select a worse
analyzer — which is precisely the "a capability that answers differently depending on which
subsystem is asking" failure `plugin.selection.ts` exists to prevent. Filtering the analysis
candidates on the method instead would have produced a second, disagreeing pick under one key. The
one place `StitchProductionJob` still needs the ANALYZER is measuring the joined file's loudness,
and since the split that is genuinely a second pick a station may not have. **`AudioJoin.overlays` is the
second thing it can do**, added when the soundboard wanted it: an overlay is anchored to a JOIN
rather than to a timestamp, because a caller knows which boundary it means and does not know how long
the parts will come out, and a negative `offsetMs` is what pulls a sound under the tail of what came
before. Nothing MOVES for an overlay, which is the whole difference from a part. Summing is where
clipping starts, so `with_headroom` scales the buffer linearly rather than limiting it — a limiter
changes the shape of the loud moment, which belongs to whoever masters the audio, and the station
re-measures what it made anyway, so only the ratio the caller asked for survives either way. **The
joined row is `production_id` with a NULL `production_ordinal`**, which is why migration 0016's
constraint says an ordinal requires a production rather than both-or-neither: every guard that
already says "a production beat is not an ordinary break" is written as `production_id is null` and
the joined row wants all of them, `SegmentRepository.recast` above most of all, since without it a
changeover would reopen a finished programme and wipe its script. **It is born `ready`**, which is a
safety property rather than a shortcut — `claimForRender` starts at `written`, so a joined row that
began there would eventually be claimed by a retry and hand a whole phone-in to the engine as one
line in one voice. **Every failure lands in the same place**: no mixer, a join that threw, a media
type the store cannot hold, all leave the production `ready` with no
joined row and the beats go in as a block, which is what every station got before this existed and
what a station with no mixer gets permanently — the feed says which of the two it was. And **it is
still a GROUP even at one item**, because `groupId` is how `releaseUnheardProductions` and `remove`
know a segment belongs to a programme. `listReady`/`readyKinds` now exclude everything a production
owns, since a kind is free text and a `callin` band could otherwise draw one turn of a past phone-in
off the shelf and air it alone.

**A production writes down what it wrote, which is what gives a caller a memory.**
`ScriptHistoryRepository` had one caller for as long as it existed and a programme recorded nothing,
so a production was invisible to `/scripts`, to `llm.captureWrites` and to every pass that reads the
station's own history back. It records one row per write ATTEMPT now with the SPEAKER's key on it,
which is the whole of caller memory: `persona_notes` and `persona_stories` are keyed by a persona KEY
and know nothing about breaks, and both nightly passes iterate the roster, so a caller reaches all of
it with no new storage. The read is the same two halves in the same two turns as a break (a trait
beside the sheet, a saying beside the moment) and a story reaches a CALLER on their FIRST turn alone,
since it is the most interesting thing in a prompt by a distance and offering it every turn is
somebody who tells the same anecdote three times in four minutes. `PLAIN_KINDS` withholds both from a
production an operator called news or a bulletin, on `showsFacts`' argument one source further out.
