options {
    keys: {
        area: health
    }
}

contract Health: { # What a liveness probe gets back from the API
    status: literal("ok") # Constant. This route answers 200 or nothing at all: a process that can serve it is up, and a process that cannot never reaches the handler
    uptimeMs: int(min=0) # How long this process has been running, so a probe can tell a live server from one that has just restarted under it
    revision?: string(min=1, max=100) # The commit this station was built from, as the image's `org.opencontainers.image.revision` label says it. Absent when nothing set one, which is what a development tree and a hand-built image both honestly are
    version?: string(min=1, max=50) # The release this station is, as the image's `org.opencontainers.image.version` label says it. Absent on every build that is not a tagged release, which is most of them: `latest` follows main, so a station tracking it honestly has a commit and no version
}
