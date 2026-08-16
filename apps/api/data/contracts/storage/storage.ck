options {
    keys: {
        area: storage
    }
    services: {
        StorageService: "#src/modules/storage/storage.service.js"
    }
    security: {
        # A read, so `platform.view`, the same floor `/activity` and the catalog reads sit on.
        # Nothing here is a value an operator has to be trusted with: it is how much disk the
        # station is using, which is the sort of thing anyone allowed to look at the console should
        # be able to see before they wonder why the volume is full.
        policy: platform.view
    }
}

# How much disk the station is using, and for what.
#
# Four content stores share one volume — the station's own copies of records, cover art, the audio
# of everything it has said, and the voice previews — and until this there was no way to see any of
# them short of `du`. It exists because `playout.trackCacheMaxBytes` is a number an operator has to
# type against something.

operation /storage: {
    get: { # What is on disk, per store, against what the database says should be
        name: Read storage
        service: StorageService.readStorage
        response: {
            200: {
                application/json: StorageReport
            }
        }
    }
}
