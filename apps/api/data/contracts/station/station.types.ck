options {
    keys: {
        area: station
    }
}

# One thing that wants the operator's attention, or the fact that nothing does
contract AttentionItem: {
    code: string(min=1, max=60) # What this is, as a stable key: `silence`, `benchedCopies`, `noPersona`. The console groups and counts on it rather than on the sentence
    severity: enum(failure, warning, notice) # `failure` is the station not doing its job, `warning` is something failing beside a station that is working, and `notice` is a thing nobody has set up yet. A notice is not a fault and must not be drawn as one
    title: string(min=1, max=120) # The line an operator reads first
    detail: string(min=1, max=800) # The whole of it, in a sentence. Where the station already has words for a fact, these are those words rather than a second phrasing of them
    route: string(min=1, max=200) # The console page that can do something about it
    count?: int(min=0) # How many things this is about, where that is a number rather than a state
}

# Everything wrong or waiting, worst first
contract StationAttention: {
    items: array(AttentionItem)
}
