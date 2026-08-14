options {
    keys: {
        area: health
    }
}

contract Health: { # What a liveness probe gets back from the API
    status: literal("ok") # Constant. This route answers 200 or nothing at all: a process that can serve it is up, and a process that cannot never reaches the handler
    uptimeMs: int(min=0) # How long this process has been running, so a probe can tell a live server from one that has just restarted under it
}
