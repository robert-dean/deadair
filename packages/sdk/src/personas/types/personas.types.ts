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
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's global ones */
    templates?: string;
    /** What this persona plays, for the model that chooses records */
    music?: string;
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
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's global ones */
    templates?: string;
    /** What this persona plays, for the model that chooses records */
    music?: string;
}

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L34)
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
 * generated from [PersonaList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L27)
 */
export interface PersonaList {
    personas: Persona[];
}

export interface PersonaListInput {
    personas: PersonaInput[];
}

/**
 * What a persona says when it is asked for a break it will never air
 * generated from [PersonaRehearsal](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L43)
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
