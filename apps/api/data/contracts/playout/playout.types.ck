options {
    keys: {
        area: playout
    }
}

contract PlayoutAiredQuery: { # Which rundown item Liquidsoap has just started playing
    item: string(min=1, max=100) # The id the app put on the pushed uri's `annotate:` metadata
}

contract PlayoutBridgeHeaders: { # The shared secret gating the internal playout bridge, in both directions
    x-playout-secret: string(min=1, max=200)
}
