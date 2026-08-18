options {
    keys: {
        area: personas
    }
}

# Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
contract Persona: {
    id: readonly string(min=1, max=100)
    key: string(min=1, max=100) # A stable slug, unique per station. What a log line names and what a seeded persona is recognised by
    label: string(min=1, max=200)
    style: string(min=1, max=2000) # Completes "You are …". Who they ARE; the sheet below carries how they talk
    djName?: string(max=200) # The name this character goes by on air, overriding the station's own while it is active
    voice?: string(max=200) # The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default
    diction?: array(string(min=1, max=500)) # The dialect: grammar and substitutions that apply to every sentence rather than to a subject
    dictionMarkers?: array(string(min=1, max=100)) # Words whose presence proves the dialect survived. What a model's answer is checked against
    quirks?: array(string(min=1, max=500)) # What they always and never do on air
    catchphrases?: array(string(min=1, max=200)) # Signature phrases, asked for sparingly
    avoid?: array(string(min=1, max=200)) # Wording that breaks the character
    background?: string(max=2000) # A couple of grounded facts they may self-reference
    brevity?: enum(short, one-line) # How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one
    latitude?: enum(loose, unleashed) # How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal
    samples?: array(string(min=1, max=500)) # Lines in their own voice, used as examples and as a console preview
    templates?: string(max=20000) # This character's own break phrasings, one per line. Empty means the station's global ones
    music?: string(max=2000) # What this persona plays, for the model that chooses records
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
    diction?: array(string(min=1, max=500))
    dictionMarkers?: array(string(min=1, max=100))
    quirks?: array(string(min=1, max=500))
    catchphrases?: array(string(min=1, max=200))
    avoid?: array(string(min=1, max=200))
    background?: string(max=2000)
    brevity?: enum(short, one-line)
    latitude?: enum(loose, unleashed)
    samples?: array(string(min=1, max=500))
    templates?: string(max=20000)
    music?: string(max=2000)
}

# What a model wrote, and what had to be dropped to make it usable
contract GeneratedPersona: {
    persona: PersonaDraftView
    droppedMarkers: array(string(min=1, max=100)) # Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off
    droppedTemplates: array(string(min=1, max=500)) # Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings
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
