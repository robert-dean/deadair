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
 * generated from [PersonaList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L27)
 */
export interface PersonaList {
    personas: Persona[];
}

export interface PersonaListInput {
    personas: PersonaInput[];
}
