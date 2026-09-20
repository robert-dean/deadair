# Internals: speech, segments and pads

Words to audio: the speech plugins and their voices, the performance cues, the soundboard, the two
doors into each audio library, and how a segment moves through its stages.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Speech, voices and cues

**The station's voice is a plugin, and there are three of them now.** `speech` capability, `plugins/kokoro`,
`plugins/chatterbox` and `plugins/rhapsode`. A voice is an opaque station-level id (`host`, `newsreader`, or a persona's own key)
that the PLUGIN maps in its own config; the host never interprets it, and engine-specific knobs stay with the
engine. That map is a `list` config field with a station name, an ENGINE voice and an optional speed — it was
a single-line box of `host = af_heart` entries, which is why this station had 68 voicepacks installed and a
map holding the empty string, and why the engine cell is an autocomplete over what the server actually reports
(`suggestConfigOptions`) rather than free text with a good placeholder. It stays free text underneath, because
a Kokoro blend expression names no single voicepack and a Chatterbox clip may have been dropped in since the
last refresh.

**The two single-engine plugins SHIP a map** (`DEFAULT_VOICE_ROWS`), covering the same twenty slots against their own engines,
applied whenever the config maps NOTHING — an absent key, `"[]"`, blank and unparseable are one state, and
`shippedUnlessMapped` in each manifest is the single place that decides it. It read `config[VOICES_FIELD] ??
DEFAULT_VOICES_JSON` for as long as it existed, on the argument that this was the opposite call to
the station's break phrasings: clearing those produces a silent DJ and clearing this one produces a station
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

**`plugins/rhapsode` ships NO map, because it could not write one.** Its server holds several engines at once
and addresses a voice as the pair `(engine, voice)` — the server's own protocol says cross-engine namespacing
is the client's job and that the client keeps the table of pairs, which is what that plugin's `voices` field
is. A shipped row would have to name an engine, and which engines an operator installed is not knowable from
here; `af_heart` against an engine that is not there is `unknown_engine` on every break rather than a wrong
voice. So the engine column falls back to a `defaultEngine` setting, blank rows take it, and a station running
one engine fills that column in once. The consequence the other two plugins' argument warns about is real and
accepted: a fresh install with no rows reads everything in one voice until the operator maps them.

**It ASKS what the engine can do rather than claiming.** `GET /engines/{engine}/capabilities` is a document
per engine describing every build it can load, and `listCues`, `listDeliveries` and `listLimits` are that
document's answers — the first speech plugin to implement any of the three. Four rules make it safe.
Cues and deliveries are the UNION over every build the voices table can reach, which would be the wrong
default anywhere else and is right here because the SERVER strips what the build it is about to use does not
claim, per request: over-claiming costs a flourish rather than getting the word "laugh" read out. The
character ceiling is the MINIMUM, because the host asks once for the whole plugin and chunks everything it
says against one number. The effective build is the one the request names, then whatever is loaded, then the
engine's first — never `current`, which is absent entirely on a cold worker. And a document that will not
fetch leaves the last one standing rather than answering nothing, on this file's own rule that an engine which
could not be asked costs a plainer break and not the break.

**The same document decides the FORMAT, and that was measured rather than designed.** `mp3`, `opus` and
`flac` each need an ffmpeg with the matching encoder compiled in, and a rhapsode without one refuses the
request — `this worker cannot produce "mp3": ffmpeg is not on PATH`, 422, which is every break lost over a
setting nobody would think to change. The document's top-level `formats` says what it can actually encode
here and now, so the plugin falls back through `wav`, `flac`, `opus`, `mp3` to something on that list and logs
the substitution. `pcm` is never asked for at any point: it answers `audio/L16` with the rate in the
content-type parameters and `SEGMENT_CONTENT_TYPES` has nowhere to put it. The mime is read off the RESPONSE
rather than assumed from the request, since the server copies its worker's content type through verbatim, with
one rewrite — `audio/opus` is Ogg-encapsulated and the store files it as `ogg`.

**There is no model lifecycle in it, deliberately.** The server owns residency: it queues, evicts and reloads,
and `GET /residency` says what it is holding. The plugin's whole say is an optional `keepAliveSeconds` on each
request (`-1` never expires, `0` frees on release, blank leaves the server's own setting alone), which is the
same knob `unloadAfterRender` and `unloadAfterIdleMinutes` buy at the cost of a lifecycle, a poll loop and an
idle timer. A `speed` in the voices table is sent only where the effective build declares a `speed` dial and is
clamped to the range it declares, because an unknown dial key on that server is a 400 naming it rather than a
field quietly ignored.

**An engine that does not lazily reload is a plugin that must load it back, and the unload rides the stream's own end.** `plugins/chatterbox` is the case: after `/api/unload`, synthesis 503s until `/restart_server` is called (which hot-swaps the engine rather than killing the process, despite the name), so `ensureLoaded` runs before EVERY synthesis rather than once at startup — the previous render's unload may have emptied the server and nothing else will notice. Three things about it are load-bearing. A load that fails **unloads before retrying once**, because a CUDA OOM strands its own partial allocations (3.5 GiB measured on a 16 GiB card) and an immediate retry throws itself at a GPU it just filled. It fails as **`unavailable` rather than `upstream`**, which is what makes a cold start that ran out of budget keep the segment's words on the row instead of writing the break off. And the unload fires from the **audio stream's end** rather than from `speak`, which returns long before the audio does — all three endings count once (drained, cancelled, refused as implausible), and `SpeechGate` serializing the engine is why this needs no in-flight counter the way the previous station's renderer did. `unloadAfterRender` is **off** by default: an unload reclaims roughly 70% of what the model held, because the graphics runtime keeps the rest until the server exits, so it buys a few gigabytes at the price of a load before the next break and is worth it only on a genuinely contended card. The same argument applies to the OTHER model on that card and `plugins/llm` has no equivalent; see [station-intelligence](https://github.com/robert-dean/deadair/discussions/37).

**The same plugin also lets the model go on its own once the station has been quiet.** `unloadAfterIdleMinutes` (default 15, `0` = never) arms a timer after every synthesis ends (the same moment `unloadAfterRender` would fire, and skipped when that setting is on, since the model is already gone by then) and clears it the moment the next `speak` starts. The next break pays for a cold start, exactly as it would after any other unload. This is a plugin guessing at "quiet" from its own idle time rather than the host telling it the station stood down; see [render-plugin-readiness](https://github.com/robert-dean/deadair/discussions/29) for why that hook does not exist yet and why the timer is enough for now.

**A voice PREVIEW is keyed on what the voice currently IS, not on what it is called.** `VoiceSampleStore.keyFor` folds in `SpeechVoice.spec`, an opaque token a plugin changes whenever the rendering would (`engineVoice@speed`), because the station voice id is exactly the part that does NOT change when an operator edits the mapping under it — the file claimed a remap minted a new key for as long as it existed and could not deliver it. The other half is the HEADER: `/voices/{id}/sample` revalidates instead of carrying a day of `max-age`, since the URL names a station voice and a browser answering the next click out of its own cache means the request never arrives. Measured — with the key fixed and the header not, a remap still played the old voice and the API logged no second render. `/segments/{id}/audio` keeps its `max-age`, where the id really does identify the bytes. A speech preview asked for with a delivery folds that in as well, but only a delivery the engine performs NOW: keyed on the word that was asked for, an ordinary reading rendered by an engine that dropped it would be filed under `frantic` and served back after the operator switched to a model that performs it, with the plugin, the voice and its spec all unchanged.

**The performance cues are EIGHT, and who may use which is a permission the host holds.** `SPEECH_CUES` was
four with a stated reason — "a cough or a sniff reads as illness rather than as delivery" — which is right
about somebody paid to talk into a microphone and exactly wrong about somebody on a telephone, where the
throat-clear IS the realism. So the vocabulary widened to what the engine actually names (minus `shush`, which
is aimed AT somebody in the room and is business rather than delivery) and the split moved app-side:
`PRESENTER_CUES` is the original four, `CALLER_CUES` is all of them, and both are intersected with what the
installed engine reports.

**How much text one call may hold is the engine's to state, and an engine that says nothing is assumed to
have a limit rather than none.** `SpeechLimits.maxCharacters` is `listCues`' shape one method over
(`listLimits`, optional, asked per call, swallowed to a default), and it takes the OPPOSITE default for a
reason worth stating: an unclaimed cue is stripped and costs a plainer break, where an unknown ceiling that
turns out to be real is a request the engine REFUSES, which reaches `RenderSegmentJob` as an ordinary
`upstream` failure, indistinguishable from a broken plugin, and three of those in a row quarantine a healthy
engine. So a plugin that declares nothing gets `DEFAULT_SPEECH_MAX_CHARACTERS` (3000), which is under every
ceiling any engine this was written against documents, and `packParts` cuts to it at the strongest boundary
inside it: paragraph, then sentence, then word, then a hard cut, that last one only for a single token
longer than the whole ceiling, which is a URL rather than prose. Neither bundled plugin declares one yet, so both are packed at
the default; the number Kokoro documents is 4000 and putting it in is a one-line change once somebody has
checked it against a running server. **None of this is reachable from a break**: thirty words is the median and
the ceiling has never been in sight. It exists for reading somebody else's writing out, where the length is not
the station's to choose.

**Widening the list without narrowing the offer is how the presenter starts coughing**, which is why the
allowed set is a required parameter wherever a script is read back rather than a reach for the whole
vocabulary, and why every matcher built from the list orders the longest form first now that `clear throat` is
in it. The other half is that `readAnswer`'s tidying is `speakableScript` and BOTH paths call it: a production
beat never had it, so `the album is *The Soft Parade*` went to an engine that reads asterisks.

**Asterisks are emphasis, so the marks go and the words stay.** The strip used to delete every `*...*` run as a
stage direction, and the test for the fix above pinned what that produced: "The album is , and I love it."
Measured on 2026-09-15 over every answer the live station had captured (1,885 of them): 30 talk breaks carried a
`*...*` run, and not one was a stage direction. 28 were a title, an artist or an album in markdown italics and
2 were a stressed word. 17 of those scripts were written for air with a hole where the name had been ("Next up,
by The Verve Pipe"), and the break path refused others as `named-nothing` for naming a record the strip had taken out.
Under today's checks that is still 2 live breaks and 1 audition (`*Tornado Of Souls*`). So a run is now unwrapped
unless it reads as a stage direction, on the same stem list `(laughs)` is judged by. The title-only unwrap was
considered and is the weaker fix: half the runs were an album, a film or an ordinary word, which no record the
writer was shown would ever match. The known price is an italicised title carrying one of those words
(`*Beat It*`), which is 10 of the station's 1,388 tracks.

**How a line is READ has two halves, and only one of them crosses the boundary.** A voice's baseline is the plugin's own config: `plugins/chatterbox` has `exaggeration` and `cfgWeight` columns beside `speed`, because a number on that engine's scale means nothing to Kokoro. A break's reading is a WORD, `SpeechRequest.delivery` (`hushed` or `frantic`), and it crosses for the reason a cue does: the station asks in its own vocabulary and each engine translates, so a change of engine rewrites no row. The obvious shape was an `exaggeration` field on the request, which would have put one engine family's scale into the contract and tied every script to it. `listDeliveries` is `listCues`' twin, `SpeechService` drops an unclaimed delivery exactly where it strips an unclaimed cue, and Chatterbox's translation (`chatterbox.delivery.ts`) is a move on the voice's own dials rather than a fixed point, so a voice that is intense at rest stays more intense than its neighbours when hushed. Three things are load-bearing.

**On Chatterbox it is reactions or readings, never both, and the live station has reactions.** The `turbo` model performs the paralinguistic tags and DISCARDS both dials (upstream logs that it is ignoring them); `original` and `multilingual` read the dials and perform no tags. So the plugin gates on the resident model's `type` from `/api/model-info`, which `ensureLoaded` already fetches before every synthesis and now hands back rather than discarding, and it gates on an allowlist, since sending to an unknown build changes a rendering nobody predicted. Test connection says which of the two the loaded model does, because it is the only place an operator can learn that a dial they set is inert.

**A blank dial is not neutral.** An omitted field takes the server's own `generation_defaults`, and the station this was built against has `exaggeration: 1.3` there. So an ordinary line sends only what the row set, and a reading is worked out from the row's dial, else the server's configured default (read once from `/api/ui/initial-data`), else Resemble's 0.5. Taken from the textbook value instead, the live station's frantic reading would have been calmer than its ordinary one.

**The row keeps the reading and clears it with the words**, unlike `voice`: `segments.delivery` is written by `writeScript` every time (null when absent), nulled by a recast, and returned by `claimForRender`'s hand-written column list, which is the one read in that repository that `SEGMENT_COLUMNS` does not reach and the one `pads` once shipped missing from. Every take of a padded break carries it, since hushed before the drop and ordinary after would be two breaks.

## Pads


**A character also has a SOUNDBOARD, and a pad is deliberately not a segment.** `deadair.pads` (migration
0023) is the rack — short sounds filled from `media/pads/<board>/`, exactly as the segment inbox is filled and
for its reason, though it is a LIBRARY rather than an inbox and carries no `inbox/` level: the content store
is rewritten from it by every boot scan, so this directory is the half a backup has to carry (`storage-env`,
[backup-and-restore](https://github.com/robert-dean/deadair/discussions/6)), and the container never had the extra level the dev default used to — and
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

**Going first means the pad strip tidies for the lexicon too, so it closes only the gap a pad left.** Both
`withoutPads` and `keepPads` used to take the hits out and then close every space in front of `.,!?;:` in
the whole script. That glued `Produced by ?uestlove` into `by?uestlove` ahead of `applyPronunciations`,
whose matcher needs a non-letter on the left, so the entry could never fire (`.38 Special` likewise). Through
`keepPads` it reached the STORED script as well. `rewritePads` now takes each removed hit's own whitespace
with it and leaves a space only between words, closing onto punctuation only where that punctuation ends
something rather than opens a name.

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
boot scan and [backup-and-restore](https://github.com/robert-dean/deadair/discussions/6) carries the directory, so bytes that reached only the store
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

**What this repository SHIPS in `assets/pads/` is CC0 or nothing, and today it is nothing.** Everything
redistributed here has to carry a public-domain dedication or its equivalent; audio that merely requires
attribution is REFUSED rather than credited, because a radio station has nowhere to put a credit and the
obligation would travel silently to every self-hoster who pulls the image. `assets/pads/MANIFEST.json` is the
provenance record and is shaped by that: a `sha256` per file, because the claim is about bytes rather than
about a page, and an `uploader`, because CC0 on an upload site is self-asserted and who asserted it is the
only thing anybody can check later. It is empty deliberately rather than pending — sourcing verified
public-domain audio is a research task with a legal edge and nobody has done it — and the seam around it
(`PadLibrary.seed`, `PAD_ASSETS_DIR`, the `COPY assets/pads` in the Dockerfile) exists so that the day
somebody does, it is a file drop rather than a feature.

And **the URL door is USE rather than redistribution**, which is where that rule draws its line: an
operator naming an address is choosing a file exactly as dropping one in is, there is deliberately no
allowlist, and what the rule still blocks is a CATALOGUE — a console panel that searches a sample library is
this project steering somebody at files and vouching for them.

## Segments and their stages

**A segment carries a state per STAGE** — `planned → writing → written → rendering → ready`, with `failed` off the side — because making a break is two jobs with different failure modes: `WriteBreakJob` decides the words and `RenderSegmentJob` produces the audio, each claiming the row with a conditional update so a duplicate send is free. `claimForRender` starts at `written`, which is what makes a retry after a failed render re-speak the words already on the row instead of paying a writer to invent different ones. A render the engine turned away as `unavailable` is not a failure at all: the job hands the row back to `written` with none of the three attempts spent, and `BreakPlanner.retryRenders` finds it through `SegmentRepository.handedBack`, which asks for rows whose LAST transition came out of `rendering` so that a break the writer has only just finished is not mistaken for one. It is asked for again on every boundary while it is inside the write-ahead window. Until 13 September that sweep read only `failed` rows, so every break a cold Chatterbox turned away at the start of a session sat at `written` until the director passed over it at its slot. Throughout, **a segment that is not `ready` is skipped, never waited for**, which is what keeps a broken renderer from ever costing the station silence.

**The SEGMENT inbox has the same two doors, and the two rules that differ are both about what a segment IS.**
`POST /segments/upload` and `DELETE /segments/{id}` sit beside the scan and write into the same directory, on
the archive argument above — [backup-and-restore](https://github.com/robert-dean/deadair/discussions/6) carries the inbox and the boot scan rewrites
the store from it. What does NOT carry over is the naming: a pad's identity is `(board, name)` and a segment's
is its CHECKSUM, so a second file under one name REPLACES a pad's slot and is a second SEGMENT. Writing it
over the first would leave that row's `source_path` naming somebody else's bytes and the archive carrying
those in place of the audio it plays, so `SegmentLibrary.ingest` writes `-2` beside it and leaves a
byte-identical file exactly where it is. And where a pad may only be deleted by whoever wrote its file, **any
`library` segment may be**: a pad can be REJECTED and a segment cannot, so refusing here would leave an
unwanted ident unremovable by any route while staying `ready` and therefore bookable through `readyKinds()`. A
`render` segment is refused instead, since the running order names it and `script_history` holds what was
written for it — the way to have it again is a re-render.

**A third source is `syndicated`: an episode of somebody else's programme**, fetched from the address its
feed named and written by `SegmentRepository.createSyndicated` born `ready`. It is kept off the shelf by
`listReady` and `readyKinds` for the joined production row's reason, since it airs once at its show's slot
rather than whenever a band draws its kind, and it has none of `importFile`'s checksum dedupe, because its
identity is the episode and not its bytes. See [`podcasts.md`](podcasts.md).

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

**What an entry says is held out of every pass after the lexicon, and until 15 September nothing held it.**
The lexicon's own comment promised that `spoken` reached the engine untouched, so an operator on Kokoro could
write its inline phoneme markup there, while `applyPronunciations` ran second of six and the other four went
over its output as though it were more writing. `[Jordache](/ʒɔrdæʃ/)` came out of `settle` as `Jordache(
ʒɔrdæʃ )`, and, more to the point for a table the station fills itself, the gloss pass's capitalised
syllables were read as initialisms: `UN-guhr` reached the engine as `U N-guhr`. The obvious fix was to say
in the comment that a spoken form must be a plain respelling, and that answers neither case, because the
second one IS a plain respelling. So `transposeForSpeech` parks each spoken form on one private-use code
point while the later passes run and puts it back after `settle`. Not a sentinel spelled from characters:
`settle`'s own comment is the record of `#CUELAUGH#` losing its hashes to the drop-list, and a single
code point no pass has in its vocabulary has no inside to reach into. `tidy` removes any private-use
character a script arrives with, so the only ones present at the end are the station's, and
`modifiesWhatFollows` reads a held entry as a word, since `a $20 P!nk shirt` read singular when the name
was still letters.

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
