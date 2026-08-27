# Internals: what the station says

How a break is written: the writers and their floor, the facts underneath a claim, the phrasings, the
rules in the prompt and the checks on the answer. Who is SPEAKING is [`personas.md`](personas.md),
and how the words become audio is [`render.md`](render.md).

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Who writes a break, and the floor under them

**A kind of break has SEVERAL writers, and the last one is its floor.** `BreakWriterRegistry` is
keyed by `segments.kind` and holds them in registration order, which IS preference order
(`director.module.ts`): `ModelTalkBreakWriter` in front, `TalkBreakWriter` behind it. A writer that
declines, answers with whitespace or throws is the same outcome — ask the next — so the fall-through
lives there rather than inside any one writer, and `llm.breakWriter` being off is just the first one
declining early. **The floor cannot fail**, which is what makes a slow model cost a better sentence
rather than a silent station. The registry answers with every ATTEMPT rather than only the winner,
because a model that declined and a floor that covered for it are two facts and the second alone
reads as a station that never had a model.

**The station's phrasings are the operator's.** `rotation.breakTemplates`, one per line, with the
station's own five as the DEFAULT — so clearing the box restores them rather than producing a silent
DJ, and the way to stop it talking stays `rotation.breaks`. `{{next.title}}` resolves through an
explicit map in `break.templates.ts` (which is why `{{next.album}}` is one row to add when enrichment
lands), `[[double brackets]]` mark a part dropped when it cannot be filled, and a template with an
unknown placeholder is never used and is logged once, quoted. Two rules are the writer's rather than
the operator's: a placeholder outside an optional chunk that cannot be filled means the phrasing does
not apply, and a phrasing saying nothing about the record just finished is only offered where there
is none.

**A break is written when its slot comes near, not when it is planted.** Planting stays eager and runs to the end of the order, because the position is what keeps the spacing stable; `BreakPlanner.ripen` asks for the WORDS only within `WRITE_AHEAD` items of the cursor. That is the difference between an hour of forward planning and an hour of model and speech work an operator edit can throw away. Sending is free because the job claims the row first, so the director re-offers whatever is still `planned` on every boundary and a lost job heals itself — and an off-air station writes nothing at all. Note the ordering trap it was built around: the running order is written through a THROTTLE, so a job can pick up a break the persisted row does not hold yet; the neighbours are therefore read before the claim, and absent-from-the-order means early rather than has-no-neighbours. **That rule has exactly one exception, and reading it as absolute cost every welcome the station ever tried to give.** An `interrupt` or `next` REQUEST is rendered before it is injected, so `BreakPlanner.prepareRequested` gives its segment no position on purpose and `DirectorService.injectReady` finds it one once the audio exists — for which absent-from-the-order means neither early nor has-no-neighbours but not placed yet. `WriteBreakJob` therefore asks whether a request is behind the segment before it defers, and `injectReady` carries the re-offer that `ripen` cannot, since `ripen` walks the order and this break is deliberately outside it.

## A claim needs its evidence

**A FACT is a claim with its evidence attached, and it is not a plugin's payload.** `deadair.facts`
holds one sentence each, extracted by the host out of prose a plugin handed over, with the span of
that prose that supports it. `source_url` and `source_quote` are `not null` because a claim with no
source must not be EXPRESSIBLE: what a nullable column there produces is a DJ saying something
specific, checkable and untrue in exactly the voice it uses for the things that are true. The split
that makes it work is **a plugin fetches, the host thinks** — `plugins/wikipedia` resolves a record
by its MusicBrainz id through Wikidata and hands over the article verbatim as a `SourceDocument`,
composing no sentence of its own, because only the host can check a claim against the text it came
from and there is deliberately no `llm` capability on `PluginHost`. Documents are stored and never
sent (`forTheWire`), so a better extraction later costs the upstream nothing. **The floor needs no
model**: an article's opening sentence IS a sourced speakable claim and the quote is the same span,
so `fact.lead.ts` fills the store whether or not a model exists, and `fact.model.ts` — off by
default — only adds what a lead sentence cannot carry. Its second call is the whole defence and is
a SEPARATE conversation that has never seen the article, because a model asked to check its own list
in the same breath approves it. `fact_extractions` exists because plenty of articles yield nothing,
and without a mark saying so the pass cannot tell one of those from an article it has never opened.
On air the claims **top up** rather than mix: they fill what they can and the provider `facts` take
the rest, since pooling them would put a template line in front of a sourced one at random. Their
variety comes from different places, which is why — a claim's is the cooldown applied inside the
query, a provider fact's is `chooseFacts`'s `rotate`. The stamp is at SELECTION, so a break dropped
before its slot still rests its facts; that inaccuracy is bought deliberately against a
`segment_events` reader.

**A break's forward claim is checked before it airs.** "Coming up, X" is a statement about the future
baked into audio that cannot be re-cut, so `segments.claims_item_id` records the lineup LINE the
words named, and `toPlayerItems` drops the break when that is no longer what plays next. The next
record is offered to a writer only when it is the adjacent line, since a promise made across an
intervening segment is the least trustworthy kind. Silence on one boundary beats a wrong fact.

## What the prompt says, and what it left out

**What buys a character room is what the break does not have to say, never the word ceiling.**
Measured before changing anything: 2 of 137 captured answers reached `DEFAULT_MAX_WORDS` and the
median break came in at 28 words, so the ceiling was never what bounded one — the model stops on its
own, and the question is what it spends those 28 words on. It was spending them on content (both
titles, both artists, a note recited) with a marker at the front and a signature at the end, which is
a listing with decoration rather than somebody talking. So the three things that changed all ASK FOR
LESS: a break may hand over ONE of the two records it was shown, the notes are offered rather than
requested (`You do not have to use any of them` — "work at most one of them in" read as an
instruction to work one in, and notes reached 108 of those 137 prompts), and "make one point" is a
rule. Raising the ceiling was considered and rejected on the measurement: it would have permitted
something nothing was asking for. **A rule true of one kind and false of the next belongs on
`BreakPromptShape.rules`**, which is what "make one point" forced into existence — it is exactly
right for a link between two records and a licence to drop two thirds of a bulletin if the news shape
had to read it.

**Asking for less overshot in exactly one place, and the correction is the load-bearing half now.**
The rule read "naming them is the least useful thing you can do with your one point", and a model
reading that stopped naming them AT ALL: of thirty-nine consecutive talk breaks under one persona,
roughly three quarters named neither record ("Tonight the groove lands. Friend, a cue from Jerez
rises" is verbatim). Every existing check passed them, because they are unmistakably the character
speaking — the listener just has no idea what is playing. So the ask is now both halves in one
sentence (name a record, THEN say what you make of it), and `BreakPromptShape.mustNameRecord` makes
the named half checkable: `named-nothing` declines a script that carries neither title nor artist of
anything it was shown. It is on the talk break ALONE — a welcome frequently has no record and a
bulletin's job is the stories — and `namedRecordIn` is deliberately generous (title, title with any
parenthetical dropped, or artist), because what is being caught is a break about no record at all and
every refusal costs the station the model's sentence.

**Three more things the prompt never said, each one a silence a model filled.** It never said what
half of the DAY it was, because `roughTime` is twelve-hour with no am or pm — right for a listener
who is awake and useless to a model, which said "tonight" through twelve of those thirty-nine morning
breaks while the welcome beside it said good morning, with the persona's own `tonight` marker
rewarding it. `dayPart` covers all twenty-four hours (the greeting deliberately does not; its hole in
the small hours is the stretch "tonight" is RIGHT for), rides the request beside `greeting`, and
`timeClaimIn` intersects whichever claims a script actually made so the narrower window wins.

**That fix reached the kinds that did not need it and missed the one that did, for two years' worth
of breaks.** `WriteBreakJob` derives the clock, the greeting AND the daypart from `segments.airs_at`
and skips all three when there is none, and `BreakPlanner.slotsFor` stamped it on the ANCHORED walk
alone — so news and welcome had one and the ordinary talk break, planted by the station's own spacing
floor, never did. Measured live: 940 talk breaks, not one with an `airs_at`, 225 of 225 talk-break
prompts with no daypart line in them, and "tonight" going out at seven, eight, nine, ten, eleven and
noon. Every walk stamps `projected[at]` now, which also switches on the claim window for the kind of
break the station makes most of. **And stating it is necessary and not sufficient**: of the nine
scripts that named a daypart having been told one, six named a different one and every one of the six
had reached for "tonight", so `contradictsDayPart` refuses a crossing — comparing which STRETCH a
phrasing names rather than the phrasing, since "this evening" and "tonight" are one answer at nine in
the evening and "this morning" and "tonight" are never one answer at all. It declines to the floor
rather than re-drafting, on the writer registry's own argument, and asks nothing of a break that was
never told the time. A first cut grouped the day as light against dark, which got the evening pair
right and quietly permitted "this morning" being called "this afternoon". **A PRODUCTION gets the
daypart and never `roughTime`**, since a programme takes minutes to write and more to render and an
hour phrasing's window is seven or eight minutes wide; `checkBeat` asks the same question, which on a
station writing `outlined` productions never runs, so there it is prevention alone. The whole of it
rests on `station.timezone`, which defaults to empty and falls back to the container's `TZ` — nothing
set one until `deploy/` and the Unraid template did, so a stock install read the clock in UTC. It
never said what to do when a record carried NO notes, only what to do with notes — so a sheet asking
for specifics was the only instruction in the room, and the station aired invented pressing plants,
catalogue numbers and years about records it knew nothing about. And it named worn OPENINGS while
saying nothing about worn vocabulary, which merely moved the repetition into the middle of the
sentence: `overusedWords` counts the SCRIPTS a word appears in rather than its uses (four uses in one
break is a rhythm problem; one use in each of six is a habit) and names them. That last one asks and
never refuses, deliberately — `dictionMarkers` are asked for by name and counted in every answer, so
the cheapest way to pass the character check is to say the marker list again, and a check that
declined over it would be refusing the character for being itself.

## Bulletins

**A bulletin does not read a story twice, and what it is not shown is as deliberate as what it is.**
`BulletinSource` took the top `rotation.newsStoriesMin`–`Max` off a newest-first feed with nothing
remembering
the last bulletin, so on a feed that had not moved the same three stories went out in twenty-seven
consecutive bulletins across seven hours — which the twelve-hour freshness window permits and a
listener cannot tell from the station being wrong. `ReadLog` is what it now checks against: **in
memory, and that is a decision rather than a shortcut** — what was reported is already durable in
`script_history`, one row per bulletin, so this holds only "may I say it again", a question with a
twelve-hour half-life, and a restart costs one repeated bulletin instead of a migration and a sweep. Memory is the authority and the row is the record, exactly as for the running
order. Keyed on the HEADLINE rather than the item id, because one story carried by two newsrooms is
two ids and one thing a listener hears twice; it does not catch two publishers WORDING one story
differently, and nothing here does. Marked at SELECTION, so a bulletin that never airs has still
spent its stories — the same inaccuracy `chooseFacts` buys, against the same alternative of a second
writer that can disagree. `forget` runs on the way IN rather than when stories are kept, or the one
station that needs it most (a feed so slow every bulletin declines) would be the one whose log never
aged out. **When everything in the window has been read the slot is DECLINED**, on the freshness
window's own argument. The other half is `BreakPromptShape.showsFacts`, off for `NEWS_SHAPE` alone:
the record coming up is shown so the bulletin can hand back in a line, and its NOTES are withheld,
because both false discography claims this station has aired ("released in May three thousand nine
hundred thirty-three") were a model finishing a note it half-understood in the voice it had just
established as the one that reports facts. `NEWS_SHAPE.rules` then closes the two ways a bulletin
runs on, neither of which the 300-word ceiling was ever going to catch: it may not explain a word out
of a story (thin copy is a hole to leave open, not to fill — "Gravity is an inescapable force. It's
why Earth has its atmosphere and orbits the sun" aired as news, twice), and it STOPS when the stories
stop, because one bulletin reported three stories correctly and then wrote twelve more sentences
about the needle sliding into rhythm.

## The format clock, and what a break is about

**The format clock is ROWS, and what a break is ABOUT is the operator's own word.** `rotation.clockBands`
was a settings box parsed line by line, which was right while a band was three tokens somebody could
hold in their head and stopped being right the moment a band REFERENCED something: a mistyped line is
silence at a time nobody chose, reported only in a log. `deadair.clock_bands` replaced it (`position`
is the line order that was already precedence, `enabled` is what commenting a line out did, and a
check constraint keeps the anchored and spacing shapes exclusive), edited on the schedule page
because a slot and a band are one question with two answers. `clock.bands.ts` keeps only what was
always the hard half: `nextOccurrence` and the daylight-saving care under it. **Minutes rather than an
SQL `interval`**, for `starts_at_minutes`'s reason — every occurrence is computed in JS against `Intl`,
nothing does interval arithmetic in SQL, and `interval '1 mon'` is not a fixed number of milliseconds
a spacing rule could use.

What a band points at is a **topic**: `deadair.topics`, keyed by `segments.kind`, holding the
operator's own vocabulary with a `config` that is DELIBERATELY SHAPELESS (`break_requests.context`'s
rule — the code for a kind reads what it expects and nothing generic reads it). News categories are
its first kind and `docs/todo/station-moment.md`'s weather locations are the second, which is the
whole reason it is a chassis rather than a news feature; a kind declares itself to `TopicKindRegistry`
with the plugin SDK's `ConfigField`, so the console renders its form with the component that already
draws a plugin's settings and the station's. Two rules are load-bearing. `clock_bands.topic_id`
**cascades** rather than nulling, against the habit of every other reference here: a band that quietly
lost its subject would read a GENERAL bulletin under a category's name, and silence is a state an
operator can see where a wrong bulletin is not. And the subject reaches the writer through
`segments.context` — the planted sibling of a request's context, on the ROW because the words are
asked for several passes after the band claimed the slot — resolved once by `BulletinSource` into a
`BreakSubject`, so the model binding and the floor cannot resolve it differently.

**A story's category is decided by three signals, ranked, and a category that matches nothing declines
the slot.** `news.classify.ts` is pure and runs on the floor as well as under the model, so it may not
fetch and may not fail. A FEED that names its own category cannot be wrong; a publisher's own LABEL is
nearly as good and is what most feeds carry; a WORD in a headline is the weakest by a distance ("chip" is a
semiconductor in one story and a shop in the next), so it catches what the first two miss and never
defines a category. The strongest signal wins rather than the sum, or a long word list would outrank a
publisher who has already sorted their own newsroom — and a word is matched as a WHOLE word, because
`ai` inside "said" and "chain" is most of a front page. Asked for a category it cannot fill, the
bulletin DECLINES on the `clean-only` posture: demand a positive match, say so on the edge through
`CategoryWatch` (a singleton for `AdvisoryWatch`'s reason, keyed by category), and never air the
wrong thing under the right name. An UNBRIEFED bulletin spreads across categories instead of taking
the top three, because a wire is newest-first and three sport stories landing together is a sports
bulletin the station never announced as one; only the ORDER changes, and a story no category claims
takes its turn — on most stations the categories cover a fraction of what the feeds carry. Eleven
categories are seeded on `persona.defaults.ts`'s rule, none naming a feed (only this operator has
one) and `local` naming nothing at all, because only the operator knows their town and a guess would
look as though it worked. **The strongest signal is stated on the FEED**, as a row on the plugin that
reads it, and a category holds only the two fields that are about the WORDS. It was a box on the
category naming `pluginId:feedId` by hand: an id derived from a name written in another form, for a
feed the operator was not looking at. `NewsService.feedCategories()` is how the two meet — the menu
is asked what each feed says it is and the stories are joined to it on the feed id, rather than a
station's opinion being stamped onto somebody else's entry — and the word is matched against the
category's own key OR its label, since a category is written once and named twice.

## The record of what was written

**Everything the station writes is kept.** `deadair.script_history`, one row per write ATTEMPT,
append-only and with no `updated_at` — a correction is another attempt, which is another row. It
outlives its segment (`on delete set null`, denormalised), holds the writer, the model, the template,
the neighbours, the token counts and the duration, and is swept nightly against
`render.scriptHistoryDays`. The prompt and the raw answer are kept only while `llm.captureWrites` is
on, which is a switch for an evening of prompt tuning rather than a default.
