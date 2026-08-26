options {
    keys: {
        area: render
    }
}

contract Segment: { # One thing the station can play that is not a record
    id: string(min=1, max=100)
    kind: string(min=1, max=50) # What sort of element it is: `ident`, `stinger`, `talkbreak`, `news`
    state: enum(planned, writing, written, rendering, ready, failed) # One state per stage of making it. Only `ready` can go on air; the station skips anything else rather than waiting for it
    label: string(min=1, max=400) # What the console calls it, and what the mount is labelled with while it airs
    source: string(min=1, max=50) # Who made it: `library` for a file dropped into the inbox
    playable: boolean # Whether there is audio behind it yet
    script?: string(max=20000) # The words, for anything that speaks. Absent for an imported recording
    spokenScript?: string(max=20000) # The words as the speech engine was handed them: symbols said, years read as a person reads them, the station's pronunciation list applied. Absent until something has spoken it
    sourcePath?: string(max=1000) # The file in the inbox this came from. The bytes were copied, so emptying the inbox does not take it off the air
    durationMs?: int(min=0) # How long it runs. A display value: the player measures the audio itself
    error?: string(max=2000) # Why it is `failed`
    voice?: string(max=100) # The station's own name for the voice this is said in, e.g. `host`. Absent means the speech plugin's default
}

contract SegmentCreate: { # Something for the station to say, before anything has said it
    label: string(min=1, max=400) # What the console calls it, and what the mount is labelled with while it airs
    script: string(min=1, max=20000) # The words to say
    kind?: string(min=1, max=50) # What sort of element it is. Defaults to `talkbreak`
    voice?: string(max=100) # A station voice name the speech plugin knows how to map. Absent uses its default
}

contract SegmentList: { # Everything the station can play that is not a record
    segments: array(Segment)
}

contract Voice: { # A voice the station can be asked to speak in
    id: string(max=100) # What to pass as a segment's `voice`. Empty means the plugin's own default
    label: string(min=1, max=200) # What the console calls it
    description?: string(max=500) # What it sounds like, or what it maps to on the engine
}

contract VoiceList: { # The voices the station's current speech plugin offers
    voices: array(Voice)
    pluginId?: string(max=200) # Which plugin answered. Absent when nothing can speak
    reason?: string(max=500) # Why there are no voices, when there are none
}

contract ScriptOutcome: enum(written, declined, failed) # Whether there are words, and if not, which way it went wrong

contract ScriptNeighbour: { # A record a writer was told about, kept as it was told
    title: string(min=1, max=500)
    artist: string(min=1, max=500)
    facts?: array(string(max=1000)) # What it was shown about the record. A break that said nothing interesting and one that was TOLD nothing interesting read the same from the script alone
}

contract ScriptUsage: { # What the provider said the attempt cost, when it said anything
    inputTokens?: int(min=0)
    outputTokens?: int(min=0)
    totalTokens?: int(min=0)
}

contract ScriptPromptMessage: { # One turn of the conversation a writer sent
    role: string(min=1, max=50)
    content: string(max=100000)
}

contract ScriptAttempt: { # One attempt to write something the station would say, including the ones that came to nothing
    id: string(min=1, max=100)
    at: datetime
    kind: string(min=1, max=50) # What sort of break it was for: `talkbreak`, `welcome`, `news`
    writer: string(min=1, max=100) # The binding that produced or declined it
    outcome: ScriptOutcome
    personaKey?: string(max=100) # Who was presenting, as the persona's own key. Absent means nobody was, which is an ordinary state. Stamped on every attempt including the declined ones, so a character whose model breaks are all being refused is visible rather than hidden behind the floor
    label?: string(max=400)
    script?: string(max=20000) # The words. Absent for an attempt that produced none
    model?: string(max=200) # The model that said it, for a writer that used one
    source?: string(max=200) # What the line was rendered from, for a writer working from something an operator can edit
    reason?: string(max=2000) # Why, for anything that is not `written`
    segmentId?: string(max=100) # The segment this was for, while it is still known. The row outlives it
    previous?: ScriptNeighbour
    next?: ScriptNeighbour
    durationMs?: int(min=0) # How long the attempt took
    usage?: ScriptUsage
    raw?: string(max=100000) # The answer before anything read it. Only while `llm.captureWrites` is on
    prompt?: array(ScriptPromptMessage) # What the writer sent. Only while `llm.captureWrites` is on
    rating?: readonly ScriptRating # What the operator thought of it. ABSENT means nobody has said, which `neutral` does not
}

# What an operator thought of something the station said.
#
# The catalog's three spellings exactly, and deliberately not a second vocabulary: an opinion is an
# opinion whether it is about a record or about a sentence, and `catalog/rating.ts` is the one place
# the words and the column's numbers meet.
#
# `neutral` is a real answer rather than an absence. Rating something back to nothing is a thing an
# operator does, and it has to be distinguishable from never having listened, which is the field
# being absent on the attempt.
contract ScriptRating: enum(liked, neutral, disliked)

contract ScriptRatingInput: {
    rating: ScriptRating
}

contract ScriptHistoryQuery: { # One page of what the station has written, newest first
    limit?: int(min=1, max=200)
    before?: string(min=1, max=200) # Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else
    kind?: string(min=1, max=50)
    writer?: string(min=1, max=100)
    outcome?: ScriptOutcome
    personaKey?: string(min=1, max=100) # Everything ONE character has said. Absent is every character and none
    segmentId?: string(min=1, max=100) # Every attempt made for ONE break, which is how a console reaches the words behind an item of the running order. Absent is the whole history
}

contract ScriptHistoryPage: {
    attempts: array(ScriptAttempt)
    nextBefore?: string(min=1, max=200) # The cursor for the page after this one, absent once the history has been read to its end
}

contract SpeechPreviewRequest: { # Words to hear before anything has aired them
    text: string(min=1, max=2000) # What to say. Far under a segment's 20000 because this is one break heard once, and the cap is what bounds a cache keyed on the words themselves
    voice?: string(max=100) # A station voice name, as a segment's `voice`. Absent uses the plugin's own default
}

contract ScriptHistorySummaryQuery: { # The window the counts cover
    hours?: int(min=1, max=168) # How far back to count. Defaults to 24, and a week at most, because past that the nightly sweep may already have taken the rows and the count would quietly be of what survived rather than of what happened
}

contract ScriptHistorySummaryRow: { # One presenter's attempts in the window
    personaKey?: string(max=100) # Absent means nobody was presenting, which is an ordinary state rather than a gap in the data
    written: int(min=0)
    declined: int(min=0) # A decline is the writer registry working: the model had nothing to say and the floor covered for it
    failed: int(min=0)
}

contract ScriptHistorySummary: { # What each presenter has written lately, and over how long
    hours: int(min=1, max=168) # The window actually counted, echoed so a console can label the numbers it draws
    rows: array(ScriptHistorySummaryRow)
}

contract SegmentScanResult: { # What one pass over the inbox did
    scanned: int(min=0) # Audio files seen, whether or not they were already known
    imported: int(min=0) # Segments the station did not have before this pass
    skipped: int(min=0) # Files passed over: not audio it can serve, or unreadable
}

contract Pronunciation: { # One name the station says differently from how it is written
    id: string(min=1, max=100)
    written: string(min=1, max=200) # What appears in a script. Matched case-insensitively, and whole words only
    spoken: string(max=400) # What the engine is handed instead, untouched. EMPTY is meaningful: it drops the words, which is the honest reading for a marker that got into a title and is not a word
    state: enum(active, suggested, rejected) # `active` is said. `suggested` is proposed and says nothing yet. `rejected` outlives the pass that proposed it, or the same article proposes it again forever
    origin: enum(operator, gloss) # Who says so. `gloss` is a pronunciation key an encyclopaedia article printed for itself
    sourceUrl?: string(max=2000) # The article. Present on anything an operator did not type
    sourceQuote?: string(max=2000) # The sentence that says so, as it stands in the article, which is what the decision is actually made on
    subjectKind?: enum(track, album, artist) # What the article was about
    subjectId?: string(max=100)
    createdAt: string(min=1, max=40)
}

contract PronunciationList: { # The station's lexicon, oldest first
    pronunciations: array(Pronunciation)
}

contract PronunciationWrite: { # A name and how to say it
    written: string(min=1, max=200)
    spoken: string(max=400) # Empty drops the words rather than saying them
}

contract PronunciationStateWrite: { # Accepting a proposal, turning one down, or taking an entry out of use without losing it
    state: enum(active, suggested, rejected)
}

contract PronunciationQuery: { # Which part of the lexicon to read
    state?: enum(active, suggested, rejected) # Absent is all of it
}

# One sound on a soundboard, as the console draws it.
#
# `name` is what a script writes to hit it and `label` is what a person reads: two columns rather
# than one, because a token for a model and prose for an operator are different things and the
# filename produces both
contract Pad: {
    id: readonly uuid
    board: string(min=1, max=200) # Which directory it arrived in. Provenance: what reaches it is a set
    sets: readonly array(string(min=1, max=200)) # The keys of the sets it is on. Empty means it is in the library and nothing can hit it
    name: string(min=1, max=200) # What a script writes: `[sfx:airhorn]`
    label: string(min=1, max=200)
    durationMs?: int(min=0)
    loudnessLufs?: number # How loud it came out, once something measured it. Absent on a station with no analyzer, which is ordinary
    sourcePath?: string(max=500) # The file in the library directory it was imported from, so the console can say where it came from
    lastUsedAt?: datetime # When it was last hit. Absent for one nothing has reached for yet
    state: enum(active, rejected)
}

contract PadList: { # Every sound the station holds, and the sets over it
    pads: array(Pad)
    sets: array(PadSet)
}

# A named collection of pads: what a presenter is actually handed.
#
# One library, cut as many ways as an operator likes. `personas.soundboard` holds the `key`, so
# renaming a set unpoints every persona naming it — which is why `personas` says who those are
contract PadSet: {
    id: readonly uuid
    key: string(min=1, max=200) # The slug a persona names. A directory in the pad library makes one of these
    label: string(min=1, max=200)
    position: int(min=0)
    pads: readonly int(min=0) # How many sounds are on it. Zero is ordinary: it is what a set looks like before anybody drops a file
    personas: readonly array(string(min=1, max=200)) # Who is pointed at it, so a rename or a delete can say what it is about to unpoint
}

contract PadSetWrite: { # A set an operator is naming, or renaming
    key: string(min=1, max=200)
    label: string(min=1, max=200)
    position?: int(min=0)
}

contract PadSetMembership: { # Which pad, and whether it is on the set
    padId: uuid
    on: boolean
}

contract PadState: { # Turning a pad down, or putting one back
    state: enum(active, rejected)
}

contract PadScanResult: { # What one pass over the pad library did
    scanned: int(min=0) # Audio files seen, whether or not anything changed
    imported: int(min=0) # Sounds the station did not have before
    replaced: int(min=0) # Slots whose file changed under them, which every script naming them now plays
    contested: int(min=0) # Sounds that reached the library but not their set, because it already answered to their name. In the library and unreachable until somebody says where they go
    skipped: int(min=0) # Files passed over: not audio, unreadable, or named something no script could write
}
