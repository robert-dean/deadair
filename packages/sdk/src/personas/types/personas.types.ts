/**
 * Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
 * generated from [Persona](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L8)
 */
export interface Persona {
    id: string;
    /** A stable slug, unique per station. What a log line names and what a seeded persona is recognised by */
    key: string;
    label: string;
    /** Completes "You are …". Who they ARE; the sheet below carries how they talk */
    style: string;
    /** The name this character goes by on air, overriding the station's own while it is active */
    djName?: string;
    /** The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default */
    voice?: string;
    /** The dialect: grammar and substitutions that apply to every sentence rather than to a subject */
    diction?: string[];
    /** Words whose presence proves the dialect survived. What a model's answer is checked against */
    dictionMarkers?: string[];
    /** What they always and never do on air */
    quirks?: string[];
    /** Signature phrases, asked for sparingly */
    catchphrases?: string[];
    /** Wording that breaks the character */
    avoid?: string[];
    /** A couple of grounded facts they may self-reference */
    background?: string;
    /** How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one */
    brevity?: 'short' | 'one-line';
    /** How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal */
    latitude?: 'loose' | 'unleashed';
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's global ones */
    templates?: string;
    /** Whether this is the one on air. At most one per station */
    active: boolean;
}

export interface PersonaInput {
    /** A stable slug, unique per station. What a log line names and what a seeded persona is recognised by */
    key: string;
    label: string;
    /** Completes "You are …". Who they ARE; the sheet below carries how they talk */
    style: string;
    /** The name this character goes by on air, overriding the station's own while it is active */
    djName?: string;
    /** The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default */
    voice?: string;
    /** The dialect: grammar and substitutions that apply to every sentence rather than to a subject */
    diction?: string[];
    /** Words whose presence proves the dialect survived. What a model's answer is checked against */
    dictionMarkers?: string[];
    /** What they always and never do on air */
    quirks?: string[];
    /** Signature phrases, asked for sparingly */
    catchphrases?: string[];
    /** Wording that breaks the character */
    avoid?: string[];
    /** A couple of grounded facts they may self-reference */
    background?: string;
    /** How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one */
    brevity?: 'short' | 'one-line';
    /** How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal */
    latitude?: 'loose' | 'unleashed';
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's global ones */
    templates?: string;
}

/**
 * A description of a character, in the operator's own words
 * generated from [PersonaRequest](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L33)
 */
export interface PersonaRequest {
    description: string;
}

/**
 * A persona as a form's contents rather than a row: no id and not on air, because nothing has been
 * saved. The console opens this in the editor and the operator saves it through POST /personas, which
 * is what keeps generating a way of filling in the form rather than a second writer of the table
 * generated from [PersonaDraftView](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L40)
 */
export interface PersonaDraftView {
    key: string;
    label: string;
    style: string;
    djName?: string;
    voice?: string;
    diction?: string[];
    dictionMarkers?: string[];
    quirks?: string[];
    catchphrases?: string[];
    avoid?: string[];
    background?: string;
    brevity?: 'short' | 'one-line';
    latitude?: 'loose' | 'unleashed';
    samples?: string[];
    templates?: string;
}

/**
 * One thing this character has accumulated that its sheet does not hold. Two kinds and they are two
 * different claims: `said` records something it actually put on air and carries the script as its
 * evidence, so it is a record and goes straight into use; `trait` infers who the character is
 * becoming, which nothing can verify, so a model's arrives `suggested` and the operator is the check
 * generated from [PersonaNote](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L69)
 */
export interface PersonaNote {
    id: string;
    /** `said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet */
    kind: 'said' | 'trait';
    /** One sentence, because it shares a system turn with the grounding rules */
    note: string;
    /** `active` is carried into breaks. `rejected` outlives the pass that proposed it, or the same scripts propose it again forever */
    state: 'active' | 'suggested' | 'rejected';
    /** Who says so. `model` is the distil pass reading this character's own history back */
    origin: 'operator' | 'model';
    /** The attempt this was drawn from, while that row still exists. The nightly sweep takes it and the quote below stays */
    sourceScriptId?: string;
    /** The words that support it, as the station said them. What an operator actually accepts or rejects on, and required of anything a model wrote */
    sourceQuote?: string;
    /** When it was last carried into a break. Absent means never, which is what puts it at the front of the rotation */
    lastUsedAt?: string;
    createdAt: string;
}

export interface PersonaNoteInput {
    /** `said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet */
    kind: 'said' | 'trait';
    /** One sentence, because it shares a system turn with the grounding rules */
    note: string;
}

/**
 * A note an operator is writing by hand. Always active and always theirs; a proposal is something only the distil pass creates
 * generated from [PersonaNoteWrite](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L86)
 */
export interface PersonaNoteWrite {
    kind: 'said' | 'trait';
    note: string;
}

/**
 * Accepting a proposal, turning one down, or taking a note out of use without losing it
 * generated from [PersonaNoteState](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L91)
 */
export interface PersonaNoteState {
    state: 'active' | 'suggested' | 'rejected';
}

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L98)
 */
export interface PersonaRehearsalAttempt {
    /** Which binding was asked, as `segments.writer` would record it */
    writer: string;
    /** written, declined or failed. Declined is the station working; failed is something to go and fix */
    outcome: string;
    /** Kept for every writer rather than only a slow one: "the model got slower" can only be asked of numbers gathered before anybody suspected it */
    durationMs: number;
    /** What it produced, when it produced anything usable */
    script?: string;
    /** Why it did not, when it did not. A sentence, because its destination is a person */
    reason?: string;
}

/**
 * generated from [PersonaList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L28)
 */
export interface PersonaList {
    personas: Persona[];
}

export interface PersonaListInput {
    personas: PersonaInput[];
}

/**
 * What a model wrote, and what had to be dropped to make it usable
 * generated from [GeneratedPersona](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L59)
 */
export interface GeneratedPersona {
    persona: PersonaDraftView;
    /** Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off */
    droppedMarkers: string[];
    /** Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings */
    droppedTemplates: string[];
}

/**
 * One character's whole notebook, oldest first, in every state
 * generated from [PersonaNoteList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L81)
 */
export interface PersonaNoteList {
    personaId: string;
    notes: PersonaNote[];
}

export interface PersonaNoteListInput {
    personaId: string;
    notes: PersonaNoteInput[];
}

/**
 * What a persona says when it is asked for a break it will never air
 * generated from [PersonaRehearsal](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L107)
 */
export interface PersonaRehearsal {
    personaId: string;
    /** The invented record the break follows. Fixed, so two readings of the same sheet can be compared */
    previous: string;
    /** The invented record it leads into */
    next: string;
    attempts: PersonaRehearsalAttempt[];
    /** The words a listener would have heard, from whichever writer answered first */
    script?: string;
    /** Which one that was. Present exactly when `script` is */
    writer?: string;
    /** Why there are no words, when every writer had nothing. Not a fault: a break nothing could write is one the station does not take */
    reason?: string;
}
