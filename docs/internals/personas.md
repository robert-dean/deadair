# Internals: who the station is

A persona is a voice and nothing else — it says nothing about what the station plays. This is the
sheet, what accumulates on top of it, and how much rope a character is given.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## The sheet

**Who the station IS is a row, and it is a VOICE and nothing else.** `deadair.personas`, one active per
station enforced by a partial unique index, with its own contract and its own console page — a table for the
reason `docs/todo/station-moment.md` argues moods are one: a `ConfigField` describes one row of a form and
this is a list an operator adds to and switches between. It replaced `llm.breakPersona` and `llm.setPersona`,
both retired, and the reason it could not stay two settings is what putting one on air does: it changes what
the model is TOLD (the sheet, in `break.prompt.ts`), what the station says when the model declined (the
persona's own `templates`, ahead of `rotation.breakTemplates` in `resolveTemplates`), and which VOICE speaks
it (`segments.voice`, stamped by `WriteBreakJob` in the same statement as the words).

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

**Every one of them names a voice, and it is its own key.** They shipped without one for a long time, on the
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
it stands without spending the next real break's lines; the stamp is at SELECTION, inheriting `chooseFacts`'
documented inaccuracy.

And **only the model reads any of it** — a template has nowhere to put a sentence like this, so a station with
no model keeps its notebook and never says anything out of it. The distil pass (`llm.personaNotes`, off) runs
at 03:41 and that time is not a preference: the script-history sweep at 04:23 deletes the material it reads.
Its watermark is carried as the column's own TEXT rather than as a `DateTime`, because Luxon is
millisecond-resolution and Postgres is microsecond, so a watermark taken from a row compares as earlier than
that row and re-reads it forever. Nothing here judges whether a break was any GOOD, because nothing in the
station records that; the one clause that will is named in a comment on `ScriptHistoryRepository.writtenBy`
and `docs/todo/break-ratings.md` holds the other end, including why a rating cannot be a column on
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
story is READ, in `WriteBreakJob`, because reading one is what spends it: a rung consulted at render time
would leave the store reporting tellings nobody heard. It governs the ordinary talk break ALONE, since a
`story` band on the clock is an operator asking in as many words.

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
dropped along with "make one point". Four seeds carry one and `persona.defaults.ts` names them; the fence that
decides what a character is POINTED at lives in each sheet's own `quirks` and `avoid` rather than in the
licence, and is an instruction rather than an enforcement.

**The licence decides the register and the sheet decides the target**, which is a split rather than a
phrasing: it used to end "never about the person listening", and that came out because a sheet may
legitimately aim a character at the listener (the shipped `wisecrack` does) and a prompt carrying both the
quirk and the prohibition is two rules that disagree, which a model resolves by hedging into neither.
