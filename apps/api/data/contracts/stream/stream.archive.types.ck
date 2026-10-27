options {
    keys: {
        area: stream
    }
}

# What a recording holds: a live show, or an hour of the station's own programme.
contract RecordingKind: enum(live, hour)

# One file in the station's archive of what it aired.
contract Recording: {
    id: readonly string(min=1, max=64) # Names the recording, e.g. `2026-10-27T21-03-12-live`
    kind: readonly RecordingKind
    title?: readonly string(max=200) # The show's name, for a live show armed with one
    startedAt: readonly datetime
    endedAt?: readonly datetime # Absent while it is still being recorded
    bytes: readonly int(min=0)
    recording: readonly boolean # Still being written. It cannot be deleted until it ends
    audioUrl: readonly string(min=1, max=2000) # Where a player can stream it from, signed for a while so an audio element needs no token. Relative to the API
}

# Every recording, newest first, and whether the station is recording at all.
contract RecordingList: {
    mode: readonly enum(off, live, all) # What the archive is set to keep
    retentionDays: readonly int(min=0) # How long a finished recording is kept. Zero keeps all of them
    recordings: array(Recording)
}
