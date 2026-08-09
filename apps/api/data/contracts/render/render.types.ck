options {
    keys: {
        area: render
    }
}

contract Segment: { # One thing the station can play that is not a record
    id: string(min=1, max=100)
    kind: string(min=1, max=50) # What sort of element it is: `ident`, `stinger`, `talkbreak`, `news`
    state: enum(planned, rendering, ready, failed) # Only `ready` can go on air. The station skips anything else rather than waiting for it
    label: string(min=1, max=400) # What the console calls it, and what the mount is labelled with while it airs
    source: string(min=1, max=50) # Who made it: `library` for a file dropped into the inbox
    playable: boolean # Whether there is audio behind it yet
    script?: string(max=20000) # The words, for anything that speaks. Absent for an imported recording
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

contract SegmentScanResult: { # What one pass over the inbox did
    scanned: int(min=0) # Audio files seen, whether or not they were already known
    imported: int(min=0) # Segments the station did not have before this pass
    skipped: int(min=0) # Files passed over: not audio it can serve, or unreadable
}
