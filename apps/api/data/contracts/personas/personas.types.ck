options {
    keys: {
        area: personas
    }
}

# Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
contract Persona: {
    id: readonly string(min=1, max=100)
    key: string(min=1, max=100) # A stable slug, unique per station. What a log line names and what a seeded persona is recognised by
    kind?: enum(host, caller) # What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant
    label: string(min=1, max=200)
    style: string(min=1, max=2000) # Completes "You are …". Who they ARE; the sheet below carries how they talk
    djName?: string(max=200) # The name this character goes by on air, overriding the station's own while it is active
    voice?: string(max=200) # The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default
    soundboard?: string(max=200) # The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word
    diction?: array(string(min=1, max=500)) # The dialect: grammar and substitutions that apply to every sentence rather than to a subject
    dictionMarkers?: array(string(min=1, max=100)) # Words whose presence proves the dialect survived. What a model's answer is checked against
    quirks?: array(string(min=1, max=500)) # What they always and never do on air
    preoccupations?: array(string(min=1, max=500)) # The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing
    catchphrases?: array(string(min=1, max=200)) # Signature phrases, asked for sparingly
    avoid?: array(string(min=1, max=200)) # Wording that breaks the character
    background?: string(max=2000) # A couple of grounded facts they may self-reference
    brevity?: enum(short, one-line) # How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one
    latitude?: enum(loose, unleashed) # How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal
    storytelling?: enum(never, occasionally, often) # How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says
    samples?: array(string(min=1, max=500)) # Lines in their own voice, used as examples and as a console preview
    templates?: string(max=20000) # This character's own break phrasings, one per line. Empty means the station's global ones
    active: readonly boolean # Whether this is the one on air. At most one per station
}

contract PersonaList: {
    personas: array(Persona)
}

# A description of a character, in the operator's own words
contract PersonaRequest: {
    description: string(min=1, max=2000)
}

# A persona as a form's contents rather than a row: no id and not on air, because nothing has been
# saved. The console opens this in the editor and the operator saves it through POST /personas, which
# is what keeps generating a way of filling in the form rather than a second writer of the table
contract PersonaDraftView: {
    key: string(min=1, max=100)
    label: string(min=1, max=200)
    style: string(min=1, max=2000)
    djName?: string(max=200)
    voice?: string(max=200)
    soundboard?: string(max=200)
    diction?: array(string(min=1, max=500))
    dictionMarkers?: array(string(min=1, max=100))
    quirks?: array(string(min=1, max=500))
    preoccupations?: array(string(min=1, max=500))
    catchphrases?: array(string(min=1, max=200))
    avoid?: array(string(min=1, max=200))
    background?: string(max=2000)
    brevity?: enum(short, one-line)
    latitude?: enum(loose, unleashed)
    storytelling?: enum(never, occasionally, often)
    samples?: array(string(min=1, max=500))
    templates?: string(max=20000)
}

# What a model wrote, and what had to be dropped to make it usable
contract GeneratedPersona: {
    persona: PersonaDraftView
    stories: array(PersonaStoryWrite) # A couple of things that have happened to this character. Beside the form rather than in it, because they are their own table: the console saves the persona and then writes these through the stories route, so they go through the same validation an operator's own typing does
    droppedMarkers: array(string(min=1, max=100)) # Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off
    droppedTemplates: array(string(min=1, max=500)) # Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings
}

# One thing this character has accumulated that its sheet does not hold. Two kinds and they are two
# different claims: `said` records something it actually put on air and carries the script as its
# evidence, so it is a record and goes straight into use; `trait` infers who the character is
# becoming, which nothing can verify, so a model's arrives `suggested` and the operator is the check
contract PersonaNote: {
    id: readonly string(min=1, max=100)
    kind: enum(said, trait) # `said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet
    note: string(min=1, max=500) # One sentence, because it shares a system turn with the grounding rules
    state: readonly enum(active, suggested, rejected) # `active` is carried into breaks. `rejected` outlives the pass that proposed it, or the same scripts propose it again forever
    origin: readonly enum(operator, model) # Who says so. `model` is the distil pass reading this character's own history back
    sourceScriptId?: readonly string(max=100) # The attempt this was drawn from, while that row still exists. The nightly sweep takes it and the quote below stays
    sourceQuote?: readonly string(max=2000) # The words that support it, as the station said them. What an operator actually accepts or rejects on, and required of anything a model wrote
    lastUsedAt?: readonly string(max=40) # When it was last carried into a break. Absent means never, which is what puts it at the front of the rotation
    createdAt: readonly string(min=1, max=40)
}

contract PersonaNoteList: { # One character's whole notebook, oldest first, in every state
    personaId: string(min=1, max=100)
    notes: array(PersonaNote)
}

contract PersonaNoteWrite: { # A note an operator is writing by hand. Always active and always theirs; a proposal is something only the distil pass creates
    kind: enum(said, trait)
    note: string(min=1, max=500)
}

contract PersonaNoteState: { # Accepting a proposal, turning one down, or taking a note out of use without losing it
    state: enum(active, suggested, rejected)
}

# Something that happened to this character, in its own telling. Not a claim about the world and never
# checked as one: `source` says where a proposal came from, for the operator reading it, and nothing
# downstream reads it as evidence — see `persona.story.ts` for why that is the load-bearing difference
# from a fact
contract PersonaStory: {
    id: readonly string(min=1, max=100)
    title: string(min=1, max=200) # A short handle. Never spoken; what this list is read by and what a proposal names
    story: string(min=1, max=4000) # The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands
    state: readonly enum(active, suggested, rejected) # `active` can be told. `rejected` outlives the pass that proposed it, or the same catalogue proposes it forever
    origin: readonly enum(operator, model) # Who says so. `model` is the enrichment pass writing from what the station already holds
    source?: readonly string(max=1000) # Where a proposal came from, in the station's own words. Absent for anything an operator wrote
    details: readonly array(PersonaStoryDetail) # What it has picked up since, in every state
    lastToldAt?: readonly string(max=40) # Absent means never told, which is what puts it at the front of the rotation
    timesTold: readonly int(min=0) # How often it has gone out, which changes how the model is asked to tell it
    createdAt: readonly string(min=1, max=40)
}

contract PersonaStoryDetail: { # One thing a story has picked up since it was written. A row rather than a rewrite, so an invented clause can be turned down without losing the story
    id: readonly string(min=1, max=100)
    detail: string(min=1, max=1000)
    state: readonly enum(active, suggested, rejected)
    origin: readonly enum(operator, model)
    source?: readonly string(max=1000)
    createdAt: readonly string(min=1, max=40)
}

contract PersonaStoryList: { # Every story one character holds, oldest first, in every state
    personaId: string(min=1, max=100)
    stories: array(PersonaStory)
}

contract PersonaStoryWrite: { # A story an operator is writing by hand. Always active and always theirs; a proposal is something only the enrichment pass creates
    title: string(min=1, max=200)
    story: string(min=1, max=4000)
}

contract PersonaStoryDetailWrite: { # One thing to add to a story that already exists
    detail: string(min=1, max=1000)
}

contract PersonaStoryState: { # Accepting a proposal, turning one down, or taking a story out of the rotation without losing it
    state: enum(active, suggested, rejected)
}

# A character as a file: everything somebody would have to send to put this presenter on another
# station, and nothing that belongs to the station it came from
contract PersonaFile: {
    format: string(min=1, max=50) # What shape this is, so a file from a later build says so rather than being read wrongly. The shapes below are what an import actually validates; this is for the human reading the failure
    takenAt: string(min=1, max=40) # When it was exported, ISO-8601
    station?: string(max=100) # The station it was taken from. Provenance only: an import writes into whichever station it is running as, and the two need not match
    personas: array(PersonaFilePersona)
}

# One character in a file. `PersonaDraftView` is the sheet with no id and not on air, which is
# exactly what travels, plus the two fields a model is deliberately not asked for and a real install
# always knows: what the character is FOR, and which rack it has to hand
contract PersonaFilePersona: PersonaDraftView & {
    kind?: enum(host, caller) # Absent means `host`, as everywhere else
    soundboard?: string(max=200) # The board this character reaches for. Carried even though the receiving station may not hold it: a persona naming a rack that does not exist and one with no rack are the same state, and the import says which it got
    stories: array(PersonaFileStory)
}

# Something that happened to this character, as a file carries it. No `origin` and no `source`,
# unlike the stored row: whoever exported this stood behind every story in it, so on the far side
# they are the receiving operator's own, and a sentence about where a proposal came from names a
# catalogue that station does not have
contract PersonaFileStory: {
    title: string(min=1, max=200)
    story: string(min=1, max=4000)
    state?: enum(active, rejected) # Absent means `active`. A turned-down story travels so the enrichment pass does not propose it again on the far side; an undecided one does not travel at all, because nobody has decided it yet
    details: array(PersonaFileStoryDetail)
}

contract PersonaFileStoryDetail: { # One thing a story picked up after it was written, carried the same way and for the same reasons
    detail: string(min=1, max=1000)
    state?: enum(active, rejected)
}

# One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
# model that declined and a floor that covered for it are two facts, and the second on its own reads
# as a station that never had a model configured
contract PersonaRehearsalAttempt: {
    writer: string(min=1, max=100) # Which binding was asked, as `segments.writer` would record it
    outcome: string(min=1, max=20) # written, declined or failed. Declined is the station working; failed is something to go and fix
    durationMs: int(min=0) # Kept for every writer rather than only a slow one: "the model got slower" can only be asked of numbers gathered before anybody suspected it
    script?: string(max=5000) # What it produced, when it produced anything usable
    reason?: string(max=1000) # Why it did not, when it did not. A sentence, because its destination is a person
}

# What a persona says when it is asked for a break it will never air
contract PersonaRehearsal: {
    personaId: string(min=1, max=100)
    previous: string(min=1, max=500) # The invented record the break follows. Fixed, so two readings of the same sheet can be compared
    next: string(min=1, max=500) # The invented record it leads into
    attempts: array(PersonaRehearsalAttempt)
    script?: string(max=5000) # The words a listener would have heard, from whichever writer answered first
    writer?: string(min=1, max=100) # Which one that was. Present exactly when `script` is
    reason?: string(max=1000) # Why there are no words, when every writer had nothing. Not a fault: a break nothing could write is one the station does not take
}
