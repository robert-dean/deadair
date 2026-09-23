# Internals: who the station is

A persona is a voice and nothing else — it says nothing about what the station plays. This is the
sheet, what accumulates on top of it, and how much rope a character is given.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## The sheet

**Who the station IS is a row, and it is a VOICE and nothing else.** `deadair.personas`, one `default_host`
per station enforced by a partial unique index, with its own contract and its own console page — a table for the
reason [station-moment](https://github.com/robert-dean/deadair/discussions/38) argues moods are one: a `ConfigField` describes one row of a form and
this is a list an operator adds to and switches between. It replaced `llm.breakPersona` and `llm.setPersona`,
both retired, and the reason it could not stay two settings is what putting one on air does: it changes what
the model is TOLD (the sheet, in `break.prompt.ts`), what the station says when the model declined (the
persona's own `templates`, ahead of the station's own five in `resolveTemplates`), and which VOICE speaks
it (`segments.voice`, stamped by `WriteBreakJob` in the same statement as the words). What it does NOT set is
how theatrical that voice is: "he is always intense" is the voice's own baseline in the speech plugin's map
(Chatterbox's `exaggeration` column), and how one break is read is chosen per break by the writer
(`segments.delivery`). A sheet field for either would be a second baseline fighting the first, and one that is
inert on every engine that has no such control.


**It says nothing whatsoever about what the station PLAYS**, and the `music` line that used to is gone: it was
a FOURTH way to steer the programming beside the three keyed to the clock (`station_lineup.brief`,
`schedule_slots.brief`, `schedule.sustainingBrief`), and two prose descriptions reaching one local model made
it split the difference — so the line had to be withheld from any refill carrying a brief, which was a
structural rule costing a page of explanation in three files. Deleting the field deleted the rule, and
`SetInputs.persona` went with it: the record chooser no longer learns who is presenting at all. The seeds'
`music` sentences survive as a comment in `persona.defaults.ts`, because they are exactly what an operator
wants in the brief box, and as a comment rather than a field because pairing a character with an hour is their
call. Five things are load-bearing.

**`diction` is not a quirk**: a quirk applies to the sentences it fits and diction applies to every sentence
there will ever be, which is why it leads the sheet AND is restated after the content rules — the failure it
addresses is CAUSED by those rules, since a host reads seven careful instructions about naming records
accurately and answers them in careful, plain English.

**A persona REPLACES the role sentence** rather than queueing behind it, because a model told both that it is
the voice of a radio station and that it is a pirate captain hedges.

**The templates chain rather than merge**, since mixing the pools would put plain English back in at random,
which is the whole failure.

**`dictionMarkers` make character checkable** — `readAnswer` declines a script carrying fewer than
`MIN_DICTION_MARKERS`, and declines rather than re-drafting, because the floor underneath now speaks in the
same character and a break writer's one job is not to be slow.

And **a sheet that named no markers passes everything**, because an author who filled in fewer boxes made no
checkable claim and should not have their scripts refused for it.

## A pasted character

**A pasted character is not a character**, which is the newest half and the one measured on air: of seventeen
consecutive model breaks under one persona, fifteen ended with a sample line or a signature reproduced word
for word, and every one passed the marker check — because a quoted catchphrase is exactly the evidence it
counts. So `characterFault` now judges four things rather than one, and the three new ones are each the
enforcement of a line the sheet was already sending and nothing was reading back: a sample may not be echoed
(`MAX_SAMPLE_ECHO_WORDS` of consecutive words, since the lift is as often a clause as a whole line), a
signature the station has just used is SPENT, and `avoid` is checked against the answer at last.

**Three of those four are PROHIBITIONS and only the marker floor asks for anything, which is the split
`CharacterContext.dialect` names.** It matters because a BULLETIN cannot meet the fourth — "no jokes, no
opinions" in `NEWS_SHAPE` and "sound like nobody else" are not simultaneously satisfiable, measured as every
news break under one persona falling to the floor — and the first answer to that was to drop the persona from
the news guard entirely. That was broader than the measurement and re-permitted the exact failure above: `I
said what I said` closing a talk break, a welcome and a news bulletin. So the news writer now passes `dialect:
'optional'`, which excuses the dialect and keeps the three prohibitions, and it cannot cost a bulletin because
the floor under it is the operator's own news phrasings, which chain no persona templates. Anything else that
wants to be plain wants that flag rather than a missing sheet. The spent rule is a bargain rather than a trap
— the user turn names which signatures are gone and **invites the model to invent its own instead**, on the
same argument that made the markers get sent: refusing a script for an instruction it was never given is a
trick question, and a model told only what it may not say fills the hole with a sample line, which is the
failure one rule over. Only the phrase-shaped half of `avoid` is checkable, and the entries describing a
subject stay instructions to a model, which is why the grounding rules underneath them are what actually hold.
The seeds are written from `persona.defaults.ts` in `ready()` rather than from the migration, so the
sheets have one source, and the guard is that the station is EMPTY rather than that each key is missing —
which is what makes deleting a seeded persona expressible.

**The marker floor counts HOW MANY of a character's words a script carries and never WHICH, and
`exclusiveSubjects` is the which.** Each entry is one subject written as the comma-separated words that mean
it, and a script carrying words from two entries is refused as `mixed-subjects`, with the pair named in the
reason. It was built for the conspiracy host, who believes every classic theory and was told in a quirk to
keep to one per break: with nothing behind that quirk, a break visiting bigfoot and the moon landing in forty
words passed every check. The words match the way markers do and are listed in the prompt, on the markers'
own argument. The check reads the script with the record names taken out (`withoutRecordNames`, the clock
checks' helper), because a record called "Pink Moon" is not the presenter bringing up the moon. It is excused
with the dialect, since a bulletin's subjects are its headlines, and it is retryable, since the model broke a
rule it was shown.
 They shipped without one for a long time, on the
grounds that which ids exist is a question only the installed engine can answer — right about an ENGINE id and
wrong about the STATION name the column holds, and it cost the whole roster sounding identical: nineteen
sheets, nineteen sets of diction markers, and a listener hearing one warm American female read all of them,
with nothing on any page saying that was a default rather than a choice. That count is the roster as it stood
when the failure was measured, not the roster today, which is nine hosts and two callers. Both bundled speech plugins ship a
`DEFAULT_VOICE_ROWS` map covering every seeded key plus `newsreader`, so a seed resolves on either engine and
switching engines rewrites nothing — which is the entire thing the voice indirection was built for and is only
true while the two maps agree, so `voice.slots.test.ts` holds the three lists together (the seeds say which
names exist, each plugin says what they sound like, and none of the three can import the others). The slots
are the persona KEYS rather than a second vocabulary, on `topics`' argument: one list to keep straight instead
of two and a mapping between them. Deleting a row from a plugin's map stays expressible, because an unmapped
name still falls back to the engine's default and warns once.

## The notebook

**A character also ACCUMULATES, and the two things it accumulates are two different claims.**
`deadair.personas` is a sheet somebody wrote and a break is written against that sheet plus the last few
scripts of this broadcast, so a host could never refer back to something it said last week or stay consistent
about an opinion it had already put on air. `deadair.persona_notes` is the store that answers it, keyed by
`personas.key` with no foreign key, on `script_history.persona_key`'s rule — which is itself the prerequisite
this needed and is stamped on every write ATTEMPT rather than only the winner, so a character whose model
breaks are all being refused is visible instead of hidden behind the floor.

**A `said` note records something the character actually broadcast and carries the script as its evidence, so
nothing was inferred and it goes active unattended; a `trait` note infers who the character is becoming, which
no quote can entail, so it arrives `suggested` and the operator is the check.** That asymmetry is why they are
one column rather than two tables and why the pass verifies only half of what it writes: a `trait` note read
into a prompt IS a sheet edit, just not one its author wrote. The rest is `deadair.pronunciations`' shape
exactly — `rejected` is a state rather than a deletion or the nightly pass re-proposes it forever, a partial
unique index over `lower(btrim(note))` stops it writing the same line twice while leaving an operator free to
write their own, and a `not null`-style evidence constraint makes an unsourced model note inexpressible. Four
things are load-bearing.

**The two halves land in different TURNS** — a trait beside the sheet in the system turn because it is who the
presenter IS, a saying beside the show's memory in the user turn because it is what the presenter DID — and it
is called a NOTEBOOK in `break.prompt.ts` because "the notes" has meant a record's enrichment facts there
since the facts arrived.

**`showsNotebook` withholds BOTH halves from a bulletin**, which is `showsFacts`' argument one source further
out: a model reporting the news and handed a list of the character's own past sayings will read one out, and
it is worse than a discography note because nothing about it is even trying to be true today.

**The read and the rest are two calls** (`forPrompt` then `markUsed`), so a rehearsal hears the character as
it stands without spending the next real break's lines; the notebook's stamp is still at SELECTION, inheriting
`chooseFacts`' documented inaccuracy. A STORY's is not, any more — see "The stories" below.

And **only the model reads any of it** — a template has nowhere to put a sentence like this, so a station with
no model keeps its notebook and never says anything out of it. The distil pass (`llm.personaNotes`, off) runs
at 03:41 and that time is not a preference: the script-history sweep at 04:23 deletes the material it reads.
Its watermark is carried as the column's own TEXT rather than as a `DateTime`, because Luxon is
millisecond-resolution and Postgres is microsecond, so a watermark taken from a row compares as earlier than
that row and re-reads it forever.

**The operator's opinion is now one clause in that read, and it excludes in one direction only.** A note
distilled from a break somebody thumbed down is the character being taught to repeat what did not land, so a
disliked attempt is not read — `is distinct from -1` rather than `<> -1`, because the join is a LEFT one and
most breaks are unrated, and a plain comparison against null would drop every break nobody has an opinion
about, which is nearly all of them. `liked` and `neutral` read identically: the pass's question is "is there
any reason not to learn from this" rather than "was this good", and a station that distilled only from
thumbed-up breaks would learn from the handful somebody happened to be listening to, which is a worse bias
than the one this removes. The join is on the ATTEMPT that was chosen, so an operator who disliked an earlier
attempt and left the rewrite alone has said nothing about the rewrite, and the rewrite is what aired. Ratings
cascade with `script_history`, so a dislike protects for `render.scriptHistoryDays` and no longer.
[break-ratings](https://github.com/robert-dean/deadair/discussions/7) holds the other end, including why a rating cannot be a column on
`script_history` and why optimising against `characterFault` would be steering at the failure `overusedWords`
already documents.

## The stories

**A character also has a PAST, and it is the one thing here nothing can check.** `deadair.persona_stories`
(migration 0021) holds anecdotes — the night the overnight host saw three lights over the desert — with
`persona_story_details` under each, because a story GROWS: it gets told, and the next telling carries
something the last one did not, which is a child row rather than a rewrite of the telling so an operator can
turn down one invented clause without losing the story. Keyed by `personas.key` and shaped after
`persona_notes` in every respect that file argues. Five things are load-bearing.

**A story is not a FACT and must never borrow the fact store's posture**: `facts.source_url` is `not null`
because a claim about the world with no source must not be expressible, and a story is fiction about a
character the station stands behind none of — so `source` is nullable prose saying where a proposal came from
and nothing reads it as evidence. What keeps that safe is at the other end, in `break.prompt.ts`, where a
story is offered as something that happened to YOU and may never be attached to a record as a fact about the
record.

**At most ONE reaches any break**, chosen least-recently-told-first by the store, because handed material gets
used and a list of anecdotes in a forty-word break is a presenter reading their own biography.

**`personas.storytelling` (`never`/`occasionally`/`often`, absent meaning `occasionally`) is the first sheet
field that never reaches a model** — it decides whether a story is IN the prompt — and it is applied where the
story is CHOSEN, in `WriteBreakJob`, because the rung and the prompt have to agree about what the break was
given: a rung consulted at render time would leave the store reporting tellings nobody heard. It governs the
ordinary talk break ALONE, since a `story` band on the clock is an operator asking in as many words.

**Choosing a story and SPENDING one are two steps, and they used to be one.** A story is now spent by
`WriteBreakJob.spend`, after `writeScript` has won the segment, so a break that failed, was rewritten into
something else, or was claimed by another job between the writing and the commit spends nothing — the story it
chose is still owed to whatever actually airs there. That is `breaks.md`'s `ReadLog` lesson applied one
subsystem over: spending at selection cost the bulletin seven headlines in two hours when three rewrites
emptied its window. It is also the only point at which the writer's ANSWER exists, which the next paragraph
needs.

**Whether a story actually went out is read back from the words, never asked of the model.** A story on a talk
break is `offered` and most breaks leave it alone, so being in the prompt says nothing about whether a listener
heard it — and two things need the difference: the rotation moves on any CARRY, so a story the model keeps
passing over cannot block the shelf, while a story's own progress moves only on a TELLING. `WrittenBreak.toldStory`
carries it, the two `story`-kind writers set it unconditionally (the script IS the story there), the
deterministic floor never sets it, and `ModelTalkBreakWriter` asks `mentionsStory`. That check leans towards NO
on a deliberate asymmetry: a false no tells the story again in different words, which is the feature working,
while a false yes marks a part as told that nobody heard and the next break moves past it for good. The
alternative — a field the model fills in — is refused on `weather.figures.ts`' rule, which is that a model
asked to report what it just did is the check that approves its own work.

**The `story` KIND inverts the usual floor**: `StoryBreakWriter` speaks `persona_stories.story` as it stands,
because that column is already a script, so it needs no phrasing pool and chains none — and the model binding
in front earns its place by TELLING the story (to this hour, this record, a listener who has heard it twice)
rather than reading it. A character with none declines the slot, which is the classic host's shipped state and
the reason it seeds no stories.

And **the enrichment pass writes only PROPOSALS** (`llm.personaStories`, off, 04:11, after the notebook pass
so the two do not queue for the one model slot): it is the only pass on the station that runs with tools ON,
because a past is worth having only where it is grounded in records this station holds, and there is nothing
to verify a story against — so `suggested` and the operator IS the check. Both word ceilings involved are
settings now with a declared MINIMUM (`rotation.breakWords`, `rotation.storyWords`, `break.words.ts`), because
a ceiling set too low does not make a terse station, it hands every model break to the phrasings in silence.

## The ledger

**`deadair.persona_tellings` (migration 0034) records every time one of a character's stories was carried into
something it said**, and it exists because `persona_stories.last_told_at` and `times_told` are stamps that
overwrite themselves. That is enough for "whose turn is it" and is not enough for the three things asked of
them since: a story that ADVANCES needs a place in it rather than a count, a callback needs the WORDS a break
actually used, and an operator undoing what the station accrued needs something to undo — a stamp that has
been overwritten has no earlier value, and rows have. Those two columns become derived from this and then go.

**One row per SEGMENT**, so a break rewritten five times is one thing a listener hears rather than five
tellings. That is a partial unique index rather than a convention, and `replaceForSegment` is the only way a
break writes here — including writing NOTHING, because a break rewritten into one that carries no story has to
take the previous attempt's row with it or the aired edge stamps a telling that never went out.

**`said` is denormalised off `script_history`** for `persona_notes.source_quote`'s reason exactly: that table
is swept at 04:23 and this is what a later break is shown so it can refer back. It is kept only where
something was actually told, and a `check` constraint says so for a break — a telling with no words is not
one a callback can be built on.

**`aired_at` is stamped on the aired edge and the gap to `created_at` is load-bearing**, not bookkeeping: a
break is written up to eight items ahead of its slot, and a part of a story stays OWED until a listener could
actually have heard it. Without that, a break retracted before it aired silently costs a listener episode two.

## Threads

**A "story" turned out to be three things, and `persona_stories.kind` says which.** An ANECDOTE is
the shape that table was built for and most of what a character holds: self-contained, told whole or
not at all. An ARC is told a part at a time and gets somewhere. A BIT is a running joke with no end
and no order, the thing a presenter returns to and escalates. One column rather than three tables,
because everything they share is everything the store already does — the states, the handle index,
the rotation, the details, the cascade — and what differs is only how one is read INTO a break.

**`persona_story_beats` holds the parts of an arc, and a beat is a SCRIPT** for the same reason
`persona_stories.story` is: the floor speaks it as it stands, so a station with no model does not
hold arcs it can never tell. It is deliberately not a detail. A detail has no position and every
active one is shown at once; exactly ONE beat is ever shown, which is the whole of what makes an arc
an arc. Gaps in `ordinal` are legal, so inserting a part between two others never means renumbering
the rest, and both the console and the nightly pass number a new one ten past the last.

**What an arc owes next is the lowest active beat with no AIRED telling**, and aired rather than
written is the load-bearing word. A break is planned up to eight items ahead of its slot and can be
retracted in between, so a part skipped on the strength of a break nobody heard is one nothing will
ever offer again.

**`personas.threadGapMinutes` is a correctness bound, not taste.** Without it, two breaks planned
before either aired would both be handed part two — the listener hears one part twice and never
hears the next. A thread is ineligible while any telling of it is younger than the gap, and its
FLOOR has to stay above the time the planner's write-ahead window takes to play. The rule runs the
other way too: a telling older than the gap that never aired is treated as void, so a dropped break
gives its part back rather than stalling the arc forever. It deliberately does not apply to an
anecdote, where the rotation has always been the whole mechanism.

**A bit is shown its own history, which nothing else here is**, because a running joke only works if
a listener recognises it coming back. That is also the strongest possible invitation to reproduce
the words, so `retold-verbatim` refuses a script that does — `echoedSample`'s matcher generalised
over any list of lines, catching a partial copy for the same measured reason. `persona_story_recaps`
is the better answer to the same need: a one-line summary of where the thing has GOT to, shown
instead of the words, so a model cannot repeat sentences it was never given. The words still travel
beside it for the guard, and they are stripped from `permittedYears` on `shownWithoutRecent`'s
argument — they are past scripts, and a year the character once invented must not become permitted
evidence about a different record today. A beat and the story itself are NOT stripped: those are
prose an operator approved and the station asked to hear.

**`personas.growth` is whether a character may change itself.** `proposes` is every station until
somebody says otherwise; `self-directed` lets the nightly passes write `active` rather than
`suggested`. What makes that offerable at all, having been refused everywhere else in this tree, is
that there is now a way BACK — see "Rolling a character back" below. Without it this would be the
one-way door `pronunciations` refused to build. It is not in the generate-a-persona schema, because
a model writing a character must not be able to grant that character autonomy; it does not travel in
a persona file, because a character arriving from elsewhere and quietly rewriting itself is the one
thing the field exists to make an operator opt into; and it reaches no prompt at all.

**The one thing it does not relax** is what may be STORED unread. A model-written beat is spoken by
the deterministic floor verbatim, and that floor runs no checks — under `self-directed` it is no
longer speaking approved prose. So the pass puts its own output through `characterFault` first.
There is no broadcast-clean CHECKER anywhere in this tree (`speaksClean` shapes a prompt and nothing
reads an answer back against it), so a self-directed character inherits exactly the exposure a
seeded story already has. That is stated rather than implied, because the obvious assumption is that
autonomy is fenced further than it is, and the honest answer is that what makes it safe is the
rollback.

## Rolling a character back

**Everything a character accrues can be undone to a moment**, per persona, from the Memory panel or
`POST /personas/{id}/memory/rollback`. What goes is what the STATION accrued — every telling, every
recap, and anything the nightly passes proposed. What an operator wrote is never touched at any
depth, including a full reset, which is not a second operation but the same path with no moment
given (`-infinity`).

**The moment travels as the column's own TEXT and is parsed only to refuse a malformed one.** Luxon
is millisecond-resolution and Postgres is microsecond, so a moment taken off a row and round-tripped
through a `DateTime` compares as EARLIER than the row it came from — and "roll back to here" would
delete the row an operator clicked on. The console hands back the row's own string for the same
reason, which is also why there is no date picker: pointing at a row is both the question an operator
actually has and the only form that compares exactly.

**Nothing is put back in step afterwards**, and that is most of why the ledger is worth having: the
rotation and the telling count are READ off it rather than stored beside it, so cutting it down is
the whole of undoing them.

**Three things it cannot put back, all stated rather than hidden.** What the distil pass read, since
`script_history` is swept nightly and pulling the watermark past that window asks it to re-derive
from scripts that are gone — rolling back can forget, it cannot re-remember. A proposal that was
turned down, since deleting a `rejected` row lets the nightly pass offer it again, which the preview
counts separately and says. And a break already written: one planned before the rollback and aired
after it stamps a telling that no longer exists, which costs one row rather than anything a listener
hears, and is the price of not holding the running order still while somebody edits history.

**Re-reading the window is a separate question and defaults to off.** It is right when an operator is
testing and wrong when they are undoing a character that drifted: the second wants the conclusions
gone, and moving the watermark back invites the same pass to reach them again tonight.
`PersonaNotesRepository.pullReadThrough` is the only writer allowed to move that watermark DOWN —
`markRead` is `greatest(...)` and cannot, which is right for two passes racing and wrong here.

## How much rope

**A character can be given ROPE, and what it buys is the station asking for more rather than accepting
worse.** `personas.latitude` is `loose` / `unleashed` above the ordinary discipline, where `brevity` is
`short` / `one-line` below it, and they are two fields because they are two kinds of thing: brevity is a habit
and only ever changes one sentence of the prompt, latitude is a PERMISSION and reaches three places at once —
the word ceiling (`LATITUDE_MAX_WORDS`), the shape's rules (`BreakPromptShape.latitudeRules`, which swaps
"make one point" for a licence to follow the thought, swapped rather than appended because a model told both
hedges), and at the top rung the content licence (`LATITUDE_LICENCE`). They compose, since a terse character
can be unfiltered, and a ceiling nobody reaches costs nothing. Four things are load-bearing.

**The two ceilings come from one `maxWordsFor` call** — what the model is TOLD and what `readAnswer` cuts at
live in different files, and a character asked for seventy words and judged at forty has every break truncated
for doing as it was told, silently.

**The ceiling CUTS rather than refuses**, at the last whole sentence that fits, and declines only what cannot
be cut at one (a single over-long sentence, or a trim shorter than half the ceiling): measured on the six
answers this station ever refused for length, every one had made its point and then padded, so what the old
rule discarded was the good eighty words in front of "make of that what you will". A trim reaches
`script_history.reason` on a row whose outcome is `written`, which is what keeps it from being a silent edit.

**The SHAPE has the veto and the sheet only offers** (`allowsLatitude`, on for the talk break alone), because
a bulletin's accuracy is not a character choice.

**It narrows within station policy and never widens it**: the licence shares its slot with the broadcast-clean
rule and loses to it, so an `unleashed` persona on a clean station talks clean.

And **it switches off no refusal** — `mustNameRecord`, the three prohibitions and the dialect check all still
decline to the floor, which is why the "name a record" rule is repeated verbatim in both rule sets rather than
dropped along with "make one point". Five seeds carry one and `persona.defaults.ts` names them; the fence that
decides what a character is POINTED at lives in each sheet's own `quirks` and `avoid` rather than in the
licence, and is an instruction rather than an enforcement.

**The licence decides the register and the sheet decides the target**, which is a split rather than a
phrasing: it used to end "never about the person listening", and that came out because a sheet may
legitimately aim a character at the listener (the shipped `wisecrack` does) and a prompt carrying both the
quirk and the prohibition is two rules that disagree, which a model resolves by hedging into neither. That
seed carries a second target beside the taste as of 2026-09-16, the LABEL: the title, the band name, the album
title and the fact that a sleeve was approved, never the music itself. Its fence is two cuts of one kind, one
splitting the taste from the listener and one splitting a chosen name from the person who has it, and it
forbids describing a sleeve the writer is never shown. `persona.defaults.ts` has the argument.

**A third rung sits beside those two, and it is about MATERIAL rather than room.** `personas.trivia` has one
value, `keen`, for a presenter whose job is the story behind the record: who made it, where it came from, what
happened to it. The ordinary break could not host one. It handed over two notes, both from the recording
before the album or the artist, and told the model most breaks are better without either, so a countdown host
whose first quirk asked for "the reason somebody cared about it" was hedging between its sheet and its prompt.
Measured on the live station on 2026-09-22: of 563 records played that week, 383 carried five or more facts and
197 carried facts about the track, the album and the artist, and a break saw two of them. `keen` is latitude's
kind of field and reaches three places the same way. The job reads four facts per record, spread one per level
before a second from any (`TRIVIA_FACT_BUDGET`, through `factsForTracks`' `budget`). The ceiling rises to
`TRIVIA_MAX_WORDS` through the same `maxWordsFor`. And the prompt carries `TRIVIA_INSTRUCTIONS` in the system
turn and SWAPS the user turn's notes paragraph rather than appending to it, since "most breaks are better
without one" and "the notes are what your break is made of" are two rules that disagree. It swaps the shape's
rules too (`BreakPromptShape.triviaRules`, which win over `latitudeRules` when a character has both), because
reading a keen prompt back found the same fault one list down: the countdown sheet names the record LAST and
"name a record, and then say what you make of it" asks for it first. The swapped set still asks for a record a
listener can name, which `mustNameRecord` refuses over, and drops only the order. The shape vetoes
(`allowsTrivia`, the talk break alone), and the job asks the same shapes before it widens the read, so a
bulletin under a keen presenter is handed what it always was. The grounding rules are the part that does not
move: "say only what the notes tell you" is the same sentence, and a record with no notes still gets the
paragraph saying the station knows nothing about it.

## Hearing a character before it goes on air

**A rehearsal is one break; an AUDITION is a playlist.** `POST /personas/{id}/rehearse` writes a single break
against a fixed invented pair — no `trackId` so no facts, `recent: []`, the same two records every time — and
that is the right shape for the question it answers, which is what one sheet EDIT changed: the substrate has
to be pinned or two readings a minute apart are not comparable. What it cannot answer is whether a character
holds up over real material, and that was previously knowable only by switching the station over and waiting
an evening. `POST /personas/{id}/auditions` (migration 0024, `PersonaAuditionJob`, and the Auditions tab on
Voice) is the half in between: one host, one provider playlist, one talk break per transition, and nothing
airs. Six things are load-bearing, and every one of them is about not measuring the wrong thing.

**It is a chain of jobs over one row, never a request.** Each transition is a generation at the `preview`
tier, which queues behind everything the station does for itself and is preempted the moment a real break
wants the model, so a run of twenty is minutes to hours — and this station redeploys on any push to main. So
`persona_auditions.cursor` says which transition is next, one job claims it conditionally, writes one break
and sends the next; the row IS the checkpoint, on `productions`' argument, and the claim is what makes a
duplicate delivery free rather than a second break at one ordinal that the unique index refuses.

**It cannot air, and that is a property of what it can reach.** The job holds neither `SegmentRepository` nor
`ScriptHistoryRepository` nor `BreakRequestRepository`; the only tables under it are the two 0024 added, and
neither is in the render path. That is the rehearsal's guarantee extended over a run rather than a rule
somebody has to keep remembering — and it is checked rather than asserted: `scripts/audition.smoke.ts` counts
`segments` and `script_history` before and after a real run.

**It spends nothing the next real break is owed.** The notebook is read through `forPrompt` and never rested,
the stories through a `tellable` read that stamps nothing, and the facts through `factsForTracks(…, { stamp:
false })` — the same reading/resting split those stores were built around, applied at a new caller. A
twenty-transition run that stamped would hand the next real break this character's twenty-first-best lines,
report tellings nobody heard, and put a week of the station's best claims on cooldown for breaks that were
going to say them.

**`recent` comes from the RUN and not from the station.** This is the one place an audition deliberately
diverges from the rehearsal: `recent: []` is what makes one reading repeatable, and over a playlist it would
let the host land its signature phrase at every transition and report a repetition no broadcast produces. So
each transition is shown this run's own scripts, newest first, at the same window `WriteBreakJob` uses — and
`script_history` is never read here, nor written, so the station and the audition cannot see each other's
words.

**A model lost to the station is not recorded at all.** `preview` being preempted, or the queue running out
of patience, both end with the floor writing a perfectly good line in the character's voice — which on air is
the arrangement working and in a measurement is a lie, since an operator reading "the floor covered eight of
ten" would go and rewrite a sheet that was never asked. `WriteAttempt.code` carries `timeout` / `unavailable`
up from the gate so the job can tell that apart from a writer that actually broke, and such a transition is
put off for 45 seconds and asked again, at most three times. A model that DECLINED is recorded immediately:
that is the reading the whole feature exists to collect. It is recorded with the words it was refused for, as
`attempts[].refused` on the break's row, whatever `llm.captureWrites` says: a reason such as "read a sample
line back" cannot be acted on without knowing which line, and a measurement should not depend on a debugging
switch being on. The row keeps them and the console does not draw them yet.

**It is the before-the-fact half of `scripts/break.declines.ts`.** That report counts decline rates and marker
recall out of `script_history`, which means a sheet change is judged an evening after it ships; the tally on
an audition card is the same ratio over material an operator chose, before anything goes out. Neither
replaces the other — the report reads what a real broadcast did, and only the live table can say that.
