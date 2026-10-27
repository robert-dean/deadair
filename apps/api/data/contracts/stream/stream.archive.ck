options {
    keys: {
        area: stream
        subarea: archive
    }
    services: {
        ArchiveService: "#src/modules/stream/archive.service.js"
    }
    security: {
        # Reads at `platform.view`, the floor `/storage` and `/activity` sit on. The one write,
        # deleting a recording, overrides this with `platform.manage`.
        policy: platform.view
    }
}

# What the station kept of what it aired, while `stream.archive` is on: an MP3 per live show, and
# under `all` an hourly file of the programme too.

operation /archive/recordings: {
    get: { # Every recording in the archive, newest first
        name: List recordings
        service: ArchiveService.listRecordings
        response: {
            200: {
                application/json: RecordingList
            }
        }
    }
}

operation /archive/recordings/{id}: {
    params: {
        id: string(min=1, max=64)
    }
    delete: { # Deletes a finished recording. One still being recorded is refused
        name: Delete recording
        service: ArchiveService.deleteRecording
        security: {
            # Gone for good: nothing can make a recording again.
            policy: platform.manage
        }
    }
}

operation /archive/recordings/{id}/audio: {
    params: {
        id: string(min=1, max=64)
    }
    get: { # The audio of one recording. Answers a byte range, so a player can seek through an hour
        name: Get recording audio
        service: ArchiveService.getRecordingAudio
        # Gated by `signed.audio.middleware` instead: a signed URL, or a session holding
        # `platform.view`, because an <audio src> carries no bearer token.
        security: none
        query: {
            download?: boolean # Answer the whole file as an attachment, named after the recording
        }
        headers: {
            range?: string # A single byte range, `bytes=start-end`
        }
        response: {
            200: {
                audio/mpeg: binary
                headers: {
                    accept-ranges?: string
                    content-disposition?: string
                }
            }
            206: {
                audio/mpeg: binary
                headers: {
                    accept-ranges?: string
                    content-range: string
                }
            }
        }
    }
}
