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
    samples?: array(string(min=1, max=500)) # Lines in their own voice, used as examples and as a console preview
    templates?: string(max=20000) # This character's own break phrasings, one per line. Empty means the station's global ones
    music?: string(max=2000) # What this persona plays, for the model that chooses records
    active: readonly boolean # Whether this is the one on air. At most one per station
}

contract PersonaList: {
    personas: array(Persona)
}
