# Internals: speech, segments and pads

Words to audio: the speech plugins and their voices, the performance cues, the soundboard, the two
doors into each audio library, and how a segment moves through its stages.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Speech, voices and cues

**The station's voice is a plugin, and there are two of them now.** `speech` capability, `plugins/kokoro` and
`plugins/chatterbox`. A voice is an opaque station-level id (`host`, `newsreader`, or a persona's own key)
that the PLUGIN maps in its own config; the host never interprets it, and engine-specific knobs stay with the
engine. That map is a `list` config field with a station name, an ENGINE voice and an optional speed — it was
a single-line box of `host = af_heart` entries, which is why this station had 68 voicepacks installed and a
map holding the empty string, and why the engine cell is an autocomplete over what the server actually reports
(`suggestConfigOptions`) rather than free text with a good placeholder. It stays free text underneath, because
a Kokoro blend expression names no single voicepack and a Chatterbox clip may have been dropped in since the
last refresh.

**Both plugins SHIP a map** (`DEFAULT_VOICE_ROWS`), covering the same twenty slots against their own engines,
applied whenever the config maps NOTHING — an absent key, `"[]"`, blank and unparseable are one state, and
`shippedUnlessMapped` in each manifest is the single place that decides it. It read `config[VOICES_FIELD] ??
DEFAULT_VOICES_JSON` for as long as it existed, on the argument that this was the opposite call to
`rotation.breakTemplates`: clearing that box produces a silent DJ and clearing this one produces a station
that speaks in one voice, which an operator may legitimately want. That distinction is not one the console can
express. The settings form submits EVERY declared field on every save (`config.fields.form.tsx`,
`rowsForSubmission`), so a `list` nobody has touched is stored as `"[]"` the moment an operator edits the
server URL beside it — which made never-having-opened-the-form the only way to keep the shipped rows, and an
ordinary save the way to lose them in silence. This station lost them exactly that way and the logs are the
record: a `deadair.chatterbox` row holding `"voices":"[]"`, nineteen characters collapsed onto a
`defaultVoice` of `Axel`, and that a bare name where the clips are filenames, so the server answered 404 and
every break went to the floor. The half that is genuinely gone is the ability to ask for one voice by emptying
the table; the way to ask for it now is to map the voices onto one engine voice, which is a table an operator
can see rather than an empty box that means something. `render.speechPluginId` picks the speaker when several
can talk and takes the first in id order when nobody has, saying which — see plugin selection in
`apps/api/CLAUDE.md`.

**An engine that does not lazily reload is a plugin that must load it back, and the unload rides the stream's own end.** `plugins/chatterbox` is the case: after `/api/unload`, synthesis 503s until `/restart_server` is called (which hot-swaps the engine rather than killing the process, despite the name), so `ensureLoaded` runs before EVERY synthesis rather than once at startup — the previous render's unload may have emptied the server and nothing else will notice. Three things about it are load-bearing. A load that fails **unloads before retrying once**, because a CUDA OOM strands its own partial allocations (3.5 GiB measured on a 16 GiB card) and an immediate retry throws itself at a GPU it just filled. It fails as **`unavailable` rather than `upstream`**, which is what makes a cold start that ran out of budget keep the segment's words on the row instead of writing the break off. And the unload fires from the **audio stream's end** rather than from `speak`, which returns long before the audio does — all three endings count once (drained, cancelled, refused as implausible), and `SpeechGate` serializing the engine is why this needs no in-flight counter the way the previous station's renderer did. `unloadAfterRender` is **off** by default: an unload reclaims roughly 70% of what the model held, because the graphics runtime keeps the rest until the server exits, so it buys a few gigabytes at the price of a load before the next break and is worth it only on a genuinely contended card. The same argument applies to the OTHER model on that card and `plugins/llm` has no equivalent; see `docs/todo/station-intelligence.md`.

**A voice PREVIEW is keyed on what the voice currently IS, not on what it is called.** `VoiceSampleStore.keyFor` folds in `SpeechVoice.spec`, an opaque token a plugin changes whenever the rendering would (`engineVoice@speed`), because the station voice id is exactly the part that does NOT change when an operator edits the mapping under it — the file claimed a remap minted a new key for as long as it existed and could not deliver it. The other half is the HEADER: `/voices/{id}/sample` revalidates instead of carrying a day of `max-age`, since the URL names a station voice and a browser answering the next click out of its own cache means the request never arrives. Measured — with the key fixed and the header not, a remap still played the old voice and the API logged no second render. `/segments/{id}/audio` keeps its `max-age`, where the id really does identify the bytes.

**The performance cues are EIGHT, and who may use which is a permission the host holds.** `SPEECH_CUES` was
four with a stated reason — "a cough or a sniff reads as illness rather than as delivery" — which is right
about somebody paid to talk into a microphone and exactly wrong about somebody on a telephone, where the
throat-clear IS the realism. So the vocabulary widened to what the engine actually names (minus `shush`, which
is aimed AT somebody in the room and is business rather than delivery) and the split moved app-side:
`PRESENTER_CUES` is the original four, `CALLER_CUES` is all of them, and both are intersected with what the
installed engine reports.

**Widening the list without narrowing the offer is how the presenter starts coughing**, which is why the
allowed set is a required parameter wherever a script is read back rather than a reach for the whole
vocabulary, and why every matcher built from the list orders the longest form first now that `clear throat` is
in it. The other half is that `readAnswer`'s tidying is `speakableScript` and BOTH paths call it: a production
beat never had it, so `the album is *The Soft Parade*` went to an engine that reads asterisks.

## Pads

**A character also has a SOUNDBOARD, and a pad is deliberately not a segment.** `deadair.pads` (migration
0023) is the rack — short sounds filled from `media/pads/<board>/`, exactly as the segment inbox is filled and
for its reason, though it is a LIBRARY rather than an inbox and carries no `inbox/` level: the content store
is rewritten from it by every boot scan, so this directory is the half a backup has to carry (`storage-env`,
`docs/todo/backup-and-restore.md`), and the container never had the extra level the dev default used to — and
`personas.soundboard` names a board, which is `voice`'s indirection one level down: the sheet names a SLOT and
the library says what it sounds like, so replacing the file under a pad changes what the station plays without
touching a persona or a script.

**It is its own table rather than a `segments.kind`**, and the reason is concrete: `readyKinds()` feeds
`ClockService`, which offers every ready kind as a bookable clock band, so a kind of `pad` would put an air
horn in the format-clock menu as an hour an operator can schedule around — the same failure the joined
production row had to have patched out of `listReady` and `readyKinds`. Six things are load-bearing.

**The identity is `(board, name)` rather than the checksum**, which is the whole difference from an ident:
`SegmentRepository.importFile` dedups on bytes because two files are two idents, where a board has a slot and
dropping a better air horn in under the same filename REPLACES what that slot holds, so the import answers
three outcomes and clears the old measurements with it.

**The cue rides inside the text** (`[sfx:airhorn]`) on `SPEECH_CUES`' stated argument — a sound happens at a
PLACE in a sentence — but it is app-side in `render/pad.cues.ts` rather than in the plugin SDK, because no
plugin ever sees one: the host reads it, strips it, and hands the mixer URLs.

**Two orderings are easy to get backwards and both were.** `keepPads` runs BEFORE `speakableScript`'s bracket
strip and the strip spares what it left, or a pad admitted afterwards is admitted into a script already
emptied of pads; and `transposeForSpeech` removes pads FIRST, because `SPARE_CUES`' character class contains
`[` and `]`, so a pad reaching it arrives at the engine as the bare text `sfx:airhorn` and is read aloud.

**The hit is resolved at WRITE time onto `segments.pads`**, because a name is unique per board and only the
writer held the presenting character's board — a renderer resolving it again would have to ask who is
presenting NOW, which after a recast is somebody else with a different rack.

**The join is an improvement and never a requirement**, which is `StitchProductionJob`'s "`ready` either way"
one row down: no mixer, a refusal, a deleted pad, an unservable mime all fall back to speaking the script
whole with the cue stripped.

And **no pad landing means NO JOIN** — two takes still look joinable and are not, because the words were split
for the sole purpose of putting a sound between them, so joining them without it produces a silent hole
mid-sentence out of two separately-trimmed takes that no longer share their prosody.

**A production BEAT can hit one too, and two rules do not transfer from the break.** A beat is sent to
`render.segment` like any other segment, so the join was already underneath it; what is new is the offer and
its budget. A CALLER is never offered a board — the fiction rather than a limitation, since the board is the
station's and in the studio, so a drop on a phone turn means either the caller keeps one at home or the HOST
hit it inside a beat the host does not own, and there is no row for that. And `MAX_PRODUCTION_PADS` is 2
rather than `MAX_PADS`' 1, because one-per-segment across twenty-five beats permits a drop on every turn — the
failure that constant exists to prevent, arriving through a door it does not cover — and it is enforced by
WITHDRAWING the offer, since each beat is its own model call and a budget in the prompt is a number nothing
can honour. A re-draft is re-offered EXACTLY what its row already hit, which is the only option that neither
lets the check pass overspend the budget nor has `speakable` strip the drop in silence. The deterministic
floor (`render.padEveryBreaks`, 4) applies to the DETERMINISTIC writer alone: a model shown the rack and
choosing not to reach for it has made a judgement about its own sentence, and appending a sound to words
somebody else shaped is two rules that disagree. Its spacing is counted from the rows rather than held in
memory, on `ReadLog`'s decision inverted — a read log has a twelve-hour half-life where this is a RHYTHM, and
a station restarted every hour would hit a pad on the first break every time.

**A pad has THREE doors and one library, and the file on disk is what makes that true.** Dropping files in
`media/pads/<board>/` was the only way in, which is fine with a shell and is not fine on the production image,
where that directory is inside a container an operator reaches through whatever share they set up — so `POST
/pads` takes a multipart upload and `POST /pads/fetch` takes an address they typed.

**Every door goes through `PadLibrary.ingest`, which WRITES THE FILE into that directory**, and that write is
the one step in the seam that is not best-effort: the content store is rewritten from the library by every
boot scan and `docs/todo/backup-and-restore.md` carries the directory, so bytes that reached only the store
are a pad absent from every export and gone after a restore, with nothing logged. Four things are
load-bearing.

**The file is named after the NAME rather than after whatever arrived** (`<board>/<name>.<ext>`), because
`padNameOf` runs on the filename at the next scan and a sound saved as `Air Horn (2).wav` under the name
`airhorn` comes back as a SECOND pad; the same rule is why `padName` normalises a typed name identically to a
filename's stem, and why the console shows the derived `[sfx:…]` token before it sends anything.

**`pads.source` is now load-bearing** where migration 0023 left it as pure provenance: it decides whether the
console may DELETE a pad, since reject-not-delete is an argument about the scan re-reading the directory and
the answer to that is removing the file — which the console may do for a file it wrote (`upload`, `url`) and
may not for one the operator dropped in (`library`), because deleting somebody else's file is not a thing a
station does.

**`subdirectoryIsSafe` is checked inside the seam** rather than at each door, since what is wanted is that
nothing can escape the library root rather than that each caller remembered; it sits in `segment.store.ts`
because both audio libraries take a directory name from somebody typing, and a second copy of a path rule is a
second thing that can be relaxed by accident.

And **the URL door is USE rather than redistribution**, which `pad-licensing.md` now says in as many words: an
operator naming an address is choosing a file exactly as dropping one in is, there is deliberately no
allowlist, and what that file still blocks is a CATALOGUE — a console panel that searches a sample library is
this project steering somebody at files and vouching for them.

## Segments and their stages

**A segment carries a state per STAGE** — `planned → writing → written → rendering → ready`, with `failed` off the side — because making a break is two jobs with different failure modes: `WriteBreakJob` decides the words and `RenderSegmentJob` produces the audio, each claiming the row with a conditional update so a duplicate send is free. `claimForRender` starts at `written`, which is what makes a retry after a failed render re-speak the words already on the row instead of paying a writer to invent different ones. Throughout, **a segment that is not `ready` is skipped, never waited for**, which is what keeps a broken renderer from ever costing the station silence.

**The SEGMENT inbox has the same two doors, and the two rules that differ are both about what a segment IS.**
`POST /segments/upload` and `DELETE /segments/{id}` sit beside the scan and write into the same directory, on
the archive argument above — `docs/todo/backup-and-restore.md` carries the inbox and the boot scan rewrites
the store from it. What does NOT carry over is the naming: a pad's identity is `(board, name)` and a segment's
is its CHECKSUM, so a second file under one name REPLACES a pad's slot and is a second SEGMENT. Writing it
over the first would leave that row's `source_path` naming somebody else's bytes and the archive carrying
those in place of the audio it plays, so `SegmentLibrary.ingest` writes `-2` beside it and leaves a
byte-identical file exactly where it is. And where a pad may only be deleted by whoever wrote its file, **any
`library` segment may be**: a pad can be REJECTED and a segment cannot, so refusing here would leave an
unwanted ident unremovable by any route while staying `ready` and therefore bookable through `readyKinds()`. A
`render` segment is refused instead, since the running order names it and `script_history` holds what was
written for it — the way to have it again is a re-render.

**Nothing guards the live running order**, deliberately: `toPlayerItems` skips a segment it cannot find, which
is the path a not-ready segment already takes, and reaching from render into the director to ask permission
would invert the module order for a case that is already benign. The one thing the console must say out loud
is the KIND, because `readyKinds()` feeds the format clock and a kind nothing else uses becomes a bookable
hour in silence.

## How a word is said

**How the station SAYS a word is a row, and most of them were written by somebody else.** The lexicon left
`render.pronunciations` for `deadair.pronunciations` on the format clock's argument: an entry that arrives
from somewhere carries the article it came from and the sentence that says so, it can be REJECTED in a way
that has to outlive the next pass, and none of the three fit on a line with an arrow in the middle of it.
`applyPronunciations` is untouched and still the whole matcher — one alternation over the script, longest
written form first — and the parser went with the setting, since a row cannot be malformed. Where the entries
come from is `pronunciation.gloss.ts` over the articles the fact store already holds: English Wikipedia prints
a pronunciation key in the lead of exactly the articles that want one, and reading it costs no request to
anybody. Only the RESPELLING forms, and that is measured rather than cautious — of 539 stored articles 34
carry a bare respelling and 9 the quoted form, both of which an engine reads as they stand, while two carry
IPA, which it cannot, and a hunt for slash-delimited IPA matches 86 documents of `CD/DVD/Blu-ray` and `June
16/17/18`.

**The difficulty is that a gloss is not automatically about the name beside it**: `Madonna ( chih-KOH-nee)` is
about Ciccone, `Stevie Wonder ( STEEV-lənd)` about Steveland, and roughly half gloss one word of two — not
reliably the surname, since `Aretha Franklin ( ə-REE-thə)` glosses the first name. So the written side is
chosen by RESEMBLANCE over a consonant skeleton (a respelling and a spelling disagree about vowels by design
and agree about consonants), and `CONFIDENCE_BAR` decides whether the station says it unasked or proposes it:
0.5 puts one wrong entry on air, 0.7 makes seven right ones wait, so it sits in the middle of the plateau at
0.6 and `pronunciation.gloss.test.ts` is the record of that sweep. Three smaller things are load-bearing. The
schwa is spelled out, because no engine knows what `lə-VEEN` is, and the untouched original is what becomes
the evidence. `rejected` is a STATE rather than a deletion, because the pass re-reads an article whenever a
plugin hands over a new copy of it and a deleted proposal would come back forever. And the entry is written
BEFORE the document is marked read, which is the opposite of how a claim and its mark land together — they
share one transaction and these two repositories cannot, so the only question is which way a crash falls, and
marked-first loses a proposal for good where written-first re-reads and `holds` recognises it. The same
pattern is why `fact.lead.ts` strips a keyword-less parenthetical now: thirteen claims in this station's store
read `Lynyrd Skynyrd ( LEH-nerd SKIN-nerd) is an American rock band` and were being spoken that way.

**What a symbol stands for goes after the whole of what it names, and for `$` that was measured wrong twice.**
`saySymbols` marks the currency where the digits stop, which is right for `$5.99` and wrong for every amount
whose size is a separate word: `$17.1 Billion` went to the engine as `17.1#DOLLARS# Billion` and **aired as
"seventeen point one dollars billion"**, four times across two stories. The pass reaches as far as the scale
word now (`MONEY`), and it treats the two ways of writing one differently on purpose — a spelled `billion` is
consumed and kept exactly as the writer capitalised it, an abbreviated `$100K` is REPLACED by the word, because
consuming that one alone leaves `100K dollars` for an engine to guess at, which is the same bug one step
quieter. What holds bare letters like `m` and `b` to meaning million and billion is position: they are read
only in the two characters after a `$`, and the `\b` behind them is what stops `$5 million` being eaten by the
letter branch and `$99.99 Plaud` being read as a scale at all.

**A comma inside a figure is either a separator or the sentence's, and the digits may only take the first.**
The same regex ended on a comma as happily as on a digit, so a price closing a clause swallowed the clause's
punctuation and the currency landed behind it: `$750, save almost $500` **aired as "750, dollars save"**.
Grouping the separator with the three digits it separates tells them apart at no cost, since a comma followed
by anything but three digits was never a thousands separator. Both readings are pinned by
`speech.transpose.test.ts` against the sentences the live station actually wrote.

**And money sits in two positions, which English says differently.** Standing on its own it is plural
("Meta will pay 17.1 billion DOLLARS"); in front of the thing it describes it is singular ("a 100 billion
DOLLAR spaceport"). The pass read everything as the standing one, so every price attached to a noun came out
as "a 100 billion dollars spaceport" and "a 103,000 dollars fee" — grammatical nonsense in the position a
listener is most likely to be paying attention. `modifiesWhatFollows` decides it from the word after the
amount, and **the direction it reads from is the whole design**: what an amount describes is a NOUN, an open
class nothing can enumerate, while what follows a standing amount is a preposition, an auxiliary, a pronoun or
an adverb — closed classes, finite, listable. So `NOT_A_THING_MONEY_BUYS` names what cannot follow
attributively and everything else is taken to be the noun, which is `settle`'s own argument about its
drop-list one pass along: matching what to keep has no gap, matching what to drop always does.

What that can get wrong is one direction only. A verb or adverb missing from the list reads as a noun and the
amount before it goes singular — "500 dollar will be spent" — and the list is where that is fixed; a first
pass of it forgot `back` and `last`, which the tests caught as "$5.99 back then" and "$100K last month".
Nothing in the list can fail the other way, because every word in it is one no amount has ever described.
Punctuation and the end of the script both read as standing, since "349.99 dollar." would be wrong in the most
audible place there is.
