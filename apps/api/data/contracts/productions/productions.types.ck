options {
    keys: {
        area: productions
    }
}

# One person in a production: the presenter, or somebody cast to phone in. A snapshot rather than a
# reference, because the persona it names may be edited or deleted while the programme is still being
# made and what the turns were written as has to be what an operator reads back
contract ProductionCastMember: {
    role: enum(host, caller, guest, cohost)
    name?: string(max=200) # What they are called on air
    persona?: string(max=100) # The persona key, for a link back to the character
}

# Something a production was handed to read. The research pass takes the notes it states as fact out of these, keeping only claims whose words really are in the text
contract ProductionSource: {
    title: string(min=1, max=300) # What the source is called, for the console and for the research pass's sense of what it is reading
    url?: string(max=2000) # Where it came from, when it came from somewhere
    text?: string(max=20000) # What it says. Absent for a source given only by its address, which the research pass reads through whichever installed plugin can open a page
}

# Something the station makes rather than something it says: several beats of speech, written in several passes, that airs as one block
contract Production: {
    id: readonly string(min=1, max=100)
    kind: string(min=1, max=100) # What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration
    title: string(min=1, max=300)
    brief?: string(max=4000) # What was asked for, in the operator's own words. Distinct from the title, which is only a label
    notes?: array(string(min=1, max=500), max=40) # What it may state as fact, one short note each. The outline divides them between the beats, and nothing else it says is offered as fact
    sources?: array(ProductionSource, max=6) # What it was handed to read. Its notes are taken from these by the research pass when nobody gave it any
    research?: readonly boolean # Whether it was asked to find its own sources on the operator's trusted sites
    personaId?: string(max=100) # Who presents it. Absent falls back to the station's active persona when a pass runs
    writingMode: enum(quick, outlined, polished) # How many passes to spend on it
    targetMs: int(min=1000) # How long it should run. What the beat count and the per-beat word budgets are computed from
    state: readonly enum(planned, researching, outlining, drafting, checking, rendering, stitching, ready, aired, failed, cancelled) # `researching` is its sources being read for notes. `stitching` is the beats being joined into one piece of audio, and it leads to `ready` whether that worked or not
    error?: readonly string(max=2000) # Why making it did not work
    scheduledFor?: datetime # When it should air. Absent means as soon as it is made
    cancelledAt?: readonly datetime
    beats: readonly int(min=0) # How many beats exist so far, which is how far along the drafting is
    showId?: readonly string(max=100) # The station's own show this is an episode of, when it is one
    cast: readonly array(ProductionCastMember) # Who is on it, decided by the first pass that ran. Empty for one nobody has started, and for a programme the presenter reads alone
    createdAt: readonly datetime
}

contract ProductionList: {
    productions: array(Production)
}

# What an operator asks for. Everything else about a production is decided by the passes that make it
contract ProductionRequest: {
    kind?: string(min=1, max=100)
    title?: string(min=1, max=300) # Absent is named after its kind and the moment it was asked for, which is what somebody taking a call now wants rather than a box to fill in
    brief?: string(max=4000)
    notes?: array(string(min=1, max=500), max=40) # What it may state as fact, one short note each. Absent leaves it to general knowledge, said vaguely
    sources?: array(ProductionSource, max=6) # What to read before writing it. Given sources and no notes, a research pass takes the notes out of these first
    research?: boolean # Given nothing to read, search the operator's trusted sites for its subject and read what comes back. Needs an enrichment plugin that can, such as the web search one with trusted sites
    personaId?: string(max=100)
    writingMode?: enum(quick, outlined, polished) # Absent takes the station's `render.productionWritingMode`
    targetMs?: int(min=1000)
    scheduledFor?: datetime
}
