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
}

contract ScriptHistoryQuery: { # One page of what the station has written, newest first
    limit?: int(min=1, max=200)
    before?: string(min=1, max=200) # Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else
    kind?: string(min=1, max=50)
    writer?: string(min=1, max=100)
    outcome?: ScriptOutcome
}

contract ScriptHistoryPage: {
    attempts: array(ScriptAttempt)
    nextBefore?: string(min=1, max=200) # The cursor for the page after this one, absent once the history has been read to its end
}

contract SegmentScanResult: { # What one pass over the inbox did
    scanned: int(min=0) # Audio files seen, whether or not they were already known
    imported: int(min=0) # Segments the station did not have before this pass
    skipped: int(min=0) # Files passed over: not audio it can serve, or unreadable
}
