# Internals: what the station says

How a break is written: the writers and their floor, the facts underneath a claim, the phrasings, the
rules in the prompt and the checks on the answer. Who is SPEAKING is [`personas.md`](personas.md),
and how the words become audio is [`render.md`](render.md).

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Who writes a break, and the floor under them

**A kind of break has SEVERAL writers, and the last one is its floor.** `BreakWriterRegistry` is keyed by
`segments.kind` and holds them in registration order, which IS preference order (`director.module.ts`):
`ModelTalkBreakWriter` in front, `TalkBreakWriter` behind it. A writer that declines, answers with whitespace
or throws is the same outcome — ask the next — so the fall-through lives there rather than inside any one
writer, and `llm.breakWriter` being off is just the first one declining early.

**The floor cannot fail**, which is what makes a slow model cost a better sentence rather than a silent
station. The registry answers with every ATTEMPT rather than only the winner, because a model that declined
and a floor that covered for it are two facts and the second alone reads as a station that never had a model.

**The station's phrasings are the operator's.** `rotation.breakTemplates`, one per line, with the
station's own five as the DEFAULT — so clearing the box restores them rather than producing a silent
DJ, and the way to stop it talking stays `rotation.breaks`. `{{next.title}}` resolves through an
explicit map in `break.templates.ts` (which is why `{{next.album}}` is one row to add when enrichment
lands), `[[double brackets]]` mark a part dropped when it cannot be filled, and a template with an
unknown placeholder is never used and is logged once, quoted. Two rules are the writer's rather than
the operator's: a placeholder outside an optional chunk that cannot be filled means the phrasing does
not apply, and a phrasing saying nothing about the record just finished is only offered where there
is none.

**A break is written when its slot comes near, not when it is planted.** Planting stays eager and runs to the
end of the order, because the position is what keeps the spacing stable; `BreakPlanner.ripen` asks for the
WORDS only within `WRITE_AHEAD` items of the cursor. That is the difference between an hour of forward
planning and an hour of model and speech work an operator edit can throw away. Sending is free because the job
claims the row first, so the director re-offers whatever is still `planned` on every boundary and a lost job
heals itself — and an off-air station writes nothing at all. Note the ordering trap it was built around: the
running order is written through a THROTTLE, so a job can pick up a break the persisted row does not hold yet;
the neighbours are therefore read before the claim, and absent-from-the-order means early rather than
has-no-neighbours.

**That rule has exactly one exception, and reading it as absolute cost every welcome the station ever tried to
give.** An `interrupt` or `next` REQUEST is rendered before it is injected, so `BreakPlanner.prepareRequested`
gives its segment no position on purpose and `DirectorService.injectReady` finds it one once the audio exists
— for which absent-from-the-order means neither early nor has-no-neighbours but not placed yet.
`WriteBreakJob` therefore asks whether a request is behind the segment before it defers, and `injectReady`
carries the re-offer that `ripen` cannot, since `ripen` walks the order and this break is deliberately outside
it.

## A claim needs its evidence

**A FACT is a claim with its evidence attached, and it is not a plugin's payload.** `deadair.facts` holds one
sentence each, extracted by the host out of prose a plugin handed over, with the span of that prose that
supports it. `source_url` and `source_quote` are `not null` because a claim with no source must not be
EXPRESSIBLE: what a nullable column there produces is a DJ saying something specific, checkable and untrue in
exactly the voice it uses for the things that are true. The split that makes it work is **a plugin fetches,
the host thinks** — `plugins/wikipedia` resolves a record by its MusicBrainz id through Wikidata and hands
over the article verbatim as a `SourceDocument`, composing no sentence of its own, because only the host can
check a claim against the text it came from and there is deliberately no `llm` capability on `PluginHost`.
Documents are stored and never sent (`forTheWire`), so a better extraction later costs the upstream nothing.

**The floor needs no model**: an article's opening sentence IS a sourced speakable claim and the quote is the
same span, so `fact.lead.ts` fills the store whether or not a model exists, and `fact.model.ts` — off by
default — only adds what a lead sentence cannot carry. Its second call is the whole defence and is a SEPARATE
conversation that has never seen the article, because a model asked to check its own list in the same breath
approves it. `fact_extractions` exists because plenty of articles yield nothing, and without a mark saying so
the pass cannot tell one of those from an article it has never opened. On air the claims **top up** rather
than mix: they fill what they can and the provider `facts` take the rest, since pooling them would put a
template line in front of a sourced one at random. Their variety comes from different places, which is why — a
claim's is the cooldown applied inside the query, a provider fact's is `chooseFacts`'s `rotate`. The stamp is
at SELECTION, so a break dropped before its slot still rests its facts; that inaccuracy is bought deliberately
against a `segment_events` reader.

**A break's forward claim is checked before it airs.** "Coming up, X" is a statement about the future
baked into audio that cannot be re-cut, so `segments.claims_item_id` records the lineup LINE the
words named, and `toPlayerItems` drops the break when that is no longer what plays next. The next
record is offered to a writer only when it is the adjacent line, since a promise made across an
intervening segment is the least trustworthy kind. Silence on one boundary beats a wrong fact.

**There are three dimensions of that, and they are one argument read three ways.** A break naming the
next RECORD is overtaken by an edit (`claims_item_id`); one naming the TIME is overtaken by the clock
(`claims_time_from`/`until`); one reporting a MEASUREMENT is overtaken by the world
(`claims_reading_until`). `brokenClaim` is the single expression all three are read through, because
`BreakPlanner.ripen` asks in the write-ahead window where the answer is worth a rewrite and
`toPlayerItems` asks at hand-over where it costs the break, and two readings that could disagree
would be two bugs waiting. The shapes differ where the questions do: a time claim has two ends and
reports which one it fell off, because "just after nine" is wrong at ten to as well as at half past,
and a reading has ONE end and no direction because an observation has no not-true-yet. That asymmetry
is also which claims are worth rewriting — an early time claim re-derives the same phrasing from the
same `airs_at` and loops (it cost seven bulletins in two hours on 24 August), where a reading claim
sends the writer back to the service for a genuinely new observation.

**A LATE time claim was the same loop, and it needed the other half of the fix rather than the same
exclusion.** "The slot has drifted past the phrasing, so a rewrite fixes it" was true of the intent
and false of the code: `airs_at` was stamped once at planting and never revised, so every rewrite
re-derived the same words, re-stamped the same closed window, and was reopened on the next boundary
until the slot arrived — at which point the reopen landed in the same pass as the hand-over and the
break was dropped for still being `planned`. Measured on 30 August: 234 reopens in seven days against
94 for a record genuinely leaving the order, 64 breaks written three or more times, one written
twelve, 76 passed over at their slot. `BreakPlanner.reproject` moves `airs_at` to where the order now
projects the break on every boundary, so the second attempt is derived from a different moment than
the first and the verdict lands on `early` — which is already excluded, and is therefore where this
terminates. **The two halves are one guard**: stop refreshing the projection and the exclusion is all
that is left. It surfaced when it did because talk breaks had no `airs_at` until they were given one,
which turned a latent bug in the bulletin path into the station's ordinary case.

**And which substrates need a claim at all is declared, in a table the compiler checks.**
`SUBSTRATE_FRESHNESS` in `break.freshness.ts` maps every field of `BreakWriteRequest` to what keeps
it true between the writing and the slot, so adding a field fails `tsc` until somebody answers. It
exists because weather did not: a whole capability shipped months after `break.claims.ts`, inherited
none of it, and **nothing in the tree failed when nobody asked**. The vocabulary's most important
value is `perishable`, which admits there is no guard — a list offering only guards pushes somebody
toward the nearest one that almost fits, which is how a table like that becomes a lie.
`StationTool.freshness` asks the same question of the tool loop, which the table cannot see, and the
three `perishable` answers there (`get_weather`, `read_news`, `search_web`) are exposure DEFERRED
rather than avoided: every break writer passes `tools: false` today, so no tool answer reaches air.

## What the prompt says, and what it left out

**What buys a character room is what the break does not have to say, never the word ceiling.** Measured before
changing anything: 2 of 137 captured answers reached `DEFAULT_MAX_WORDS` and the median break came in at 28
words, so the ceiling was never what bounded one — the model stops on its own, and the question is what it
spends those 28 words on. It was spending them on content (both titles, both artists, a note recited) with a
marker at the front and a signature at the end, which is a listing with decoration rather than somebody
talking. So the three things that changed all ASK FOR LESS: a break may hand over ONE of the two records it
was shown, the notes are offered rather than requested (`You do not have to use any of them` — "work at most
one of them in" read as an instruction to work one in, and notes reached 108 of those 137 prompts), and "make
one point" is a rule. Raising the ceiling was considered and rejected on the measurement: it would have
permitted something nothing was asking for.

**A rule true of one kind and false of the next belongs on `BreakPromptShape.rules`**, which is what "make one
point" forced into existence — it is exactly right for a link between two records and a licence to drop two
thirds of a bulletin if the news shape had to read it.

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

**That fix reached the kinds that did not need it and missed the one that did, for two years' worth of
breaks.** `WriteBreakJob` derives the clock, the greeting AND the daypart from `segments.airs_at` and skips
all three when there is none, and `BreakPlanner.slotsFor` stamped it on the ANCHORED walk alone — so news and
welcome had one and the ordinary talk break, planted by the station's own spacing floor, never did. Measured
live: 940 talk breaks, not one with an `airs_at`, 225 of 225 talk-break prompts with no daypart line in them,
and "tonight" going out at seven, eight, nine, ten, eleven and noon. Every walk stamps `projected[at]` now,
which also switches on the claim window for the kind of break the station makes most of.

**And stating it is necessary and not sufficient**: of the nine scripts that named a daypart having been told
one, six named a different one and every one of the six had reached for "tonight", so `contradictsDayPart`
refuses a crossing — comparing which STRETCH a phrasing names rather than the phrasing, since "this evening"
and "tonight" are one answer at nine in the evening and "this morning" and "tonight" are never one answer at
all. It declines to the floor rather than re-drafting, on the writer registry's own argument, and asks nothing
of a break that was never told the time. A first cut grouped the day as light against dark, which got the
evening pair right and quietly permitted "this morning" being called "this afternoon".

**A PRODUCTION gets the daypart and never `roughTime`**, since a programme takes minutes to write and more to
render and an hour phrasing's window is seven or eight minutes wide; `checkBeat` asks the same question, which
on a station writing `outlined` productions never runs, so there it is prevention alone. The whole of it rests
on `station.timezone`, which defaults to empty and falls back to the container's `TZ` — nothing set one until
`deploy/` and the Unraid template did, so a stock install read the clock in UTC. It never said what to do when
a record carried NO notes, only what to do with notes — so a sheet asking for specifics was the only
instruction in the room, and the station aired invented pressing plants, catalogue numbers and years about
records it knew nothing about. And it named worn OPENINGS while saying nothing about worn vocabulary, which
merely moved the repetition into the middle of the sentence: `overusedWords` counts the SCRIPTS a word appears
in rather than its uses (four uses in one break is a rhythm problem; one use in each of six is a habit) and
names them. That last one asks and never refuses, deliberately — `dictionMarkers` are asked for by name and
counted in every answer, so the cheapest way to pass the character check is to say the marker list again, and
a check that declined over it would be refusing the character for being itself.

## Bulletins

**Which feeds a bulletin reads is a LIST the station orders, and it used to be one id typed by
hand.** `rotation.newsFeed` was a free-text box holding a single qualified feed id copied off another
page; it was blank on every install that had one, which is what an operator does with a control like
that. What it could not express is the thing a multi-feed station actually wants. `NewsService`
merges every plugin's answer newest first, so a publisher posting twenty times a day took every slot
from one posting three times, and this station read a technology site's afternoon as the day's news.
`rotation.newsFeeds` is a `list` setting whose one column offers the feeds the plugins currently
have (`station.newsFeeds`, the fourth thing only the console can enumerate), and `feedRoster` reads
it. **An empty list is every feed and a written one is the roster**: a feed nobody listed is not read
out, rather than being read after the listed ones — otherwise adding a feed to a plugin would change
what airs with nobody having decided it should. The console, the news page and `read_news` still see
every feed, because this is about what is SAID; the menu simply follows the station's order where
there is one. A listed feed the station no longer offers answers nothing and is skipped.

**A bulletin does not read a story twice, and what it is not shown is as deliberate as what it is.**
`BulletinSource` took the top `rotation.newsStoriesMin`–`Max` off a newest-first feed with nothing remembering
the last bulletin, so on a feed that had not moved the same three stories went out in twenty-seven consecutive
bulletins across seven hours — which the twelve-hour freshness window permits and a listener cannot tell from
the station being wrong. `ReadLog` is what it now checks against: **in memory, and that is a decision rather
than a shortcut** — what was reported is already durable in `script_history`, one row per bulletin, so this
holds only "may I say it again", a question with a twelve-hour half-life, and a restart costs one repeated
bulletin instead of a migration and a sweep. Memory is the authority and the row is the record, exactly as for
the running order. Keyed on the HEADLINE rather than the item id, because one story carried by two newsrooms
is two ids and one thing a listener hears twice; it does not catch two publishers WORDING one story
differently, and nothing here does. Marked at SELECTION, so a bulletin that never airs has still spent its
stories — the same inaccuracy `chooseFacts` buys, against the same alternative of a second writer that can
disagree. `forget` runs on the way IN rather than when stories are kept, or the one station that needs it most
(a feed so slow every bulletin declines) would be the one whose log never aged out.

**When everything in the window has been read the slot is DECLINED**, on the freshness window's own argument.
The other half is `BreakPromptShape.showsFacts`, off for `NEWS_SHAPE` alone: the record coming up is shown so
the bulletin can hand back in a line, and its NOTES are withheld, because both false discography claims this
station has aired ("released in May three thousand nine hundred thirty-three") were a model finishing a note
it half-understood in the voice it had just established as the one that reports facts. `NEWS_SHAPE.rules` then
closes the three ways a bulletin runs on, none of which the 300-word ceiling was ever going to catch: it may
not explain a word out of a story (thin copy is a hole to leave open, not to fill — "Gravity is an inescapable
force. It's why Earth has its atmosphere and orbits the sun" aired as news, twice), it may not read a headline
and then restate it, and it STOPS when the stories stop, because one bulletin reported three stories correctly
and then wrote twelve more sentences about the needle sliding into rhythm.

**The facts are fixed and the wording is the anchor's, and for a while the prompt asked for the opposite.**
`describeStory` called the headline the part that "may be read more or less as it stands", `NEWS_SHAPE.opening`
asked for "its headline and a sentence of what happened", and the stories rule asked for "a sentence of what
actually happened" underneath it. Between them those specify a bulletin in two halves, and the station aired
one: **42 of its first 104 bulletins read a headline and then said it again**, most plainly as "Man convicted in
murder-for-hire killing of Microsoft manager on Florida road. A man was convicted in the murder-for-hire killing
of a Microsoft manager on a Florida road." A listener hears the story twice and learns it once, and no ceiling
or guard was ever going to catch it, because it was the format being asked for.

What replaced it is a licence exactly the size of the rewording and no larger. The model is told to report in
the words an anchor would use — what happened, to whom, where, in spoken English — and told in the same breath
that the wording is its and the facts are not, with every anti-invention rule beside it unchanged and in the
same sentence as the licence. **That the headline is now source rather than copy is the whole change**, and it
is stated in three places because it was previously contradicted in three: the opening, the stories rule, and
`describeStory`'s own doc. The floor underneath is unaffected and still reads headlines verbatim, which is what
a writer that cannot rephrase is for; a bulletin that falls through is a plainer bulletin, not a wrong one.

**A guard would have made this worse, which is why there is not one.** Every other measured failure here is
refused, but the only thing a refusal can do is drop to `NewsBreakWriter`, and what the floor reads is headlines
and nothing else — so declining a bulletin for sounding like a list of headlines hands the listener a list of
headlines. The prompt is the fix and the capture in `script_history` is how it is checked.

**And the prompt was only ever half of it, which the capture is what showed.** Reading the `prompt` column back
rather than the scripts: **21 of the 34 stories in this station's captured prompts had a body that began with
its own headline, word for word**. So the two labels `describeStory` is built on — the published sentence, and
what happened — were carrying one sentence twice, and a writer told to report what the text says was doing
exactly that. Blaming the model for the restatement was wrong by about two thirds. `withoutEchoedHeadline` takes
the echo off both the body and the teaser in `toStory`, before either is cut, so the writer's ceiling is spent
on the story rather than on a line it has already been shown.

It is a PREFIX and the WHOLE headline, and it detects nothing about where the text came from. A headline quoted
mid-article is the article referring to itself and is left alone; a body sharing its opening few words with its
title is the ordinary case and is left alone. The looser versions of this all cut the lead sentence off real
reporting, which is a worse bulletin than a repeated one.

**Where the echo comes from is a feed setting, and no code here can fix it.** A feed whose links point at an
aggregator rather than at a publisher hands `fetchArticle` the aggregator's own page, and what comes back is the
headline followed by other outlets' headlines and their names — which is also where the publisher names in the
middle of aired sentences came from, and the fragments cut mid-word. Stripping the echo makes that substrate
survivable; it does not make it good. An operator seeing publisher names read out in bulletins should point the
feed at publishers.

## The weather

**A weather break is the bulletin's shape with the safety property read from the other end.** A
bulletin cannot be wrong about the news if it quotes the publisher's own words; this cannot be wrong
about the weather if it states only figures a service measured. So `WeatherSource` is
`BulletinSource`'s opposite number — it fetches once so the floor does no network I/O, resolves a
band's location the way the other resolves a category, and hands both writers one substrate — and
`WeatherBreakWriter` frames the reading with `rotation.weatherTemplates`, every phrasing carrying
`{{weather.report}}` outside its optional parts so none of them can announce the weather and then
report none.

**What the floor will not say is the point of it.** No comparison with yesterday, no advice about
coats, no "lovely afternoon": each of those is a sentence nothing can check against a source, and a
test asserts their absence rather than trusting the shape of the code. `{{weather.place}}` is filled
from the READING rather than from the subject, so a break about the station's own place — which has
no subject, because that is a setting rather than a topic — can still say where it is about.

**The model binding above it has a check no other writer has.** A bulletin's claims are sentences and
a forecast's claims are NUMBERS, and the set of true ones is known exactly, so `inventedFigure`
refuses a script naming a temperature the station was never given. That matters more here than the
shape guards do: a plausible temperature is far easier for a model to write than a plausible news
story, because it knows roughly what August in Atlanta is like and will fill one in without any sense
of having invented anything. Two gaps in it are deliberate and are tests rather than comments — a
spelled-out number gets through, and a clock time, a date or a year is not read as a measurement.

**The four ways of having nothing are told apart in the SOURCE and nowhere else.** No plugin, nowhere
named, a service that is down, and a reading that will be too old to be true when the break airs: one
silence to the writer, and four different things for an operator to do. A station whose clock asks for
the weather every hour and is silent every time needs to be told which, so `WeatherSource` names the
fix in the log and the writer only declines.

**The reading's age is judged against the SLOT, and that is the half this shipped without.** A break
is written up to eight records ahead of it, so `readingFor` takes `segments.airs_at` — the same
parameter `BulletinSource.storiesFor` was already given one line above the call — and declines a
reading that `rotation.weatherMaxAgeMinutes` says will have aged out by then. Two hours by default,
generously, because a national service can be most of an hour behind before this station sees a
reading and a tighter window silences the weather on a working install. What survives past that is
drift: `airs_at` is a projection, so both writers stamp `claims_reading_until` unconditionally —
unlike `claimsNext` and `claimsTime`, which are answered, because there is no weather break that
dropped the weather. `inventedFigure` and that stamp are the two halves: one makes the numbers
unfabricable, the other makes them expire, and neither could have done the other's job.

**Where the station is, is a SETTING and not a topic.** `station.location` is the default for every
weather feature, so a fresh install reports its own conditions without an operator creating anything;
a `weather` topic is for somewhere ELSE, which is what a band on the format clock points at.
`station.units` decides what a listener hears, and a location may override it — the capability is
metric on the wire always, and `weather.words.ts` is the one place that changes.

## The format clock, and what a break is about

**The format clock is ROWS, and what a break is ABOUT is the operator's own word.** `rotation.clockBands` was
a settings box parsed line by line, which was right while a band was three tokens somebody could hold in their
head and stopped being right the moment a band REFERENCED something: a mistyped line is silence at a time
nobody chose, reported only in a log. `deadair.clock_bands` replaced it (`position` is the line order that was
already precedence, `enabled` is what commenting a line out did, and a check constraint keeps the anchored and
spacing shapes exclusive), edited on the schedule page because a slot and a band are one question with two
answers. `clock.bands.ts` keeps only what was always the hard half: `nextOccurrence` and the daylight-saving
care under it.

**Minutes rather than an SQL `interval`**, for `starts_at_minutes`'s reason — every occurrence is computed in
JS against `Intl`, nothing does interval arithmetic in SQL, and `interval '1 mon'` is not a fixed number of
milliseconds a spacing rule could use.

What a band points at is a **topic**: `deadair.topics`, keyed by `segments.kind`, holding the
operator's own vocabulary with a `config` that is DELIBERATELY SHAPELESS (`break_requests.context`'s
rule — the code for a kind reads what it expects and nothing generic reads it). News categories are
its first kind and weather locations are the second, which is the whole reason it is a chassis rather
than a news feature and is the thing the second kind cost one file to prove; a kind declares itself to `TopicKindRegistry`
with the plugin SDK's `ConfigField`, so the console renders its form with the component that already
draws a plugin's settings and the station's. Two rules are load-bearing. `clock_bands.topic_id`
**cascades** rather than nulling, against the habit of every other reference here: a band that quietly
lost its subject would read a GENERAL bulletin under a category's name, and silence is a state an
operator can see where a wrong bulletin is not. And the subject reaches the writer through
`segments.context` — the planted sibling of a request's context, on the ROW because the words are
asked for several passes after the band claimed the slot — resolved once by `BulletinSource` or
`WeatherSource` into a `BreakSubject`, so the model binding and the floor cannot resolve it
differently. The two never both answer, because each refuses every kind but its own, which is why
`WriteBreakJob` reads them as a chain rather than merging them.

**A story's category is decided by three signals, ranked, and a category that matches nothing declines the
slot.** `news.classify.ts` is pure and runs on the floor as well as under the model, so it may not fetch and
may not fail. A FEED that names its own category cannot be wrong; a publisher's own LABEL is nearly as good
and is what most feeds carry; a WORD in a headline is the weakest by a distance ("chip" is a semiconductor in
one story and a shop in the next), so it catches what the first two miss and never defines a category. The
strongest signal wins rather than the sum, or a long word list would outrank a publisher who has already
sorted their own newsroom — and a word is matched as a WHOLE word, because `ai` inside "said" and "chain" is
most of a front page. Asked for a category it cannot fill, the bulletin DECLINES on the `clean-only` posture:
demand a positive match, say so on the edge through `CategoryWatch` (a singleton for `AdvisoryWatch`'s reason,
keyed by category), and never air the wrong thing under the right name. An UNBRIEFED bulletin spreads across
categories instead of taking the top three, because a wire is newest-first and three sport stories landing
together is a sports bulletin the station never announced as one; only the ORDER changes, and a story no
category claims takes its turn — on most stations the categories cover a fraction of what the feeds carry.
Eleven categories are seeded on `persona.defaults.ts`'s rule, none naming a feed (only this operator has one)
and `local` naming nothing at all, because only the operator knows their town and a guess would look as though
it worked.

**A category can also be a rule about what is NEVER read, which is the same matching with the
threshold moved.** A general feed from a publisher with a deals desk carries the deals desk: this
station aired a shop's discount code, a laptop sale and an affiliate disclosure ("purchases made via
a link may earn a commission") as news, in 10 of its first 213 bulletins. Nothing detected it because
nothing was looking — the entries carry the publisher's own `Deals` label and are otherwise ordinary
items. So a category may be marked OFF AIR (`offAir` on the topic's own config, read through
`flagIsOn` because the column is edited by a form and by hand), and `keptOffAir` withholds any story
it claims. Three things differ from classifying a subject, and each of them is the point. **Any rank
is enough**, where a subject takes the strongest and can afford to be unsure: a word in a headline is
the weakest signal there is and is still a reason not to broadcast an advertisement. **The withhold
happens in `NewsService.fetchItems`**, not in the bulletin, so the bulletin, `read_news` and the news
page cannot disagree about what the station has — and it happens BEFORE the limit is applied, or a
page of shopping posts would push the real stories past the cut and then be dropped. And **an off-air
category is not a subject**: `categoriesOf` skips them, so no writer is told a story is one, `spread`
never gives one a turn, the console does not offer one on a band, and `subjectOf` resolves one to
nothing — a band written before the switch was turned on would otherwise claim its slot and decline
it forever. A station whose topics table cannot be read withholds nothing, on `categories()`' rule:
the news is read exactly as it was before any of this existed.

**The strongest signal is stated on the FEED**, as a row on the plugin that reads it, and a category holds
only the two fields that are about the WORDS. It was a box on the category naming `pluginId:feedId` by hand:
an id derived from a name written in another form, for a feed the operator was not looking at.
`NewsService.feedCategories()` is how the two meet — the menu is asked what each feed says it is and the
stories are joined to it on the feed id, rather than a station's opinion being stamped onto somebody else's
entry — and the word is matched against the category's own key OR its label, since a category is written once
and named twice.

## The record of what was written

**Everything the station writes is kept.** `deadair.script_history`, one row per write ATTEMPT,
append-only and with no `updated_at` — a correction is another attempt, which is another row. It
outlives its segment (`on delete set null`, denormalised), holds the writer, the model, the template,
the neighbours, the token counts and the duration, and is swept nightly against
`render.scriptHistoryDays`. The prompt and the raw answer are kept only while `llm.captureWrites` is
on, which is a switch for an evening of prompt tuning rather than a default.
