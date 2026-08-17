options {
    keys: {
        area: productions
    }
}

# Something the station makes rather than something it says: several beats of speech, written in several passes, that airs as one block
contract Production: {
    id: readonly string(min=1, max=100)
    kind: string(min=1, max=100) # What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration
    title: string(min=1, max=300)
    brief?: string(max=4000) # What was asked for, in the operator's own words. Distinct from the title, which is only a label
    personaId?: string(max=100) # Who presents it. Absent falls back to the station's active persona when a pass runs
    writingMode: enum(quick, outlined, polished) # How many passes to spend on it
    targetMs: int(min=1000) # How long it should run. What the beat count and the per-beat word budgets are computed from
    state: readonly enum(planned, outlining, drafting, checking, rendering, ready, aired, failed, cancelled)
    error?: readonly string(max=2000) # Why making it did not work
    scheduledFor?: datetime # When it should air. Absent means as soon as it is made
    cancelledAt?: readonly datetime
    beats: readonly int(min=0) # How many beats exist so far, which is how far along the drafting is
    createdAt: readonly datetime
}

contract ProductionList: {
    productions: array(Production)
}

# What an operator asks for. Everything else about a production is decided by the passes that make it
contract ProductionRequest: {
    kind?: string(min=1, max=100)
    title: string(min=1, max=300)
    brief?: string(max=4000)
    personaId?: string(max=100)
    writingMode?: enum(quick, outlined, polished) # Absent takes the station's `render.productionWritingMode`
    targetMs?: int(min=1000)
    scheduledFor?: datetime
}
