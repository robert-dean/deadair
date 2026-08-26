/**
 * Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
 * generated from [Persona](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L8)
 */
export interface Persona {
    id: string;
    /** A stable slug, unique per station. What a log line names and what a seeded persona is recognised by */
    key: string;
    /** What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant */
    kind?: 'host' | 'caller';
    label: string;
    /** Completes "You are …". Who they ARE; the sheet below carries how they talk */
    style: string;
    /** The name this character goes by on air, overriding the station's own while it is active */
    djName?: string;
    /** The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default */
    voice?: string;
    /** The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word */
    soundboard?: string;
    /** The dialect: grammar and substitutions that apply to every sentence rather than to a subject */
    diction?: string[];
    /** Words whose presence proves the dialect survived. What a model's answer is checked against */
    dictionMarkers?: string[];
    /** What they always and never do on air */
    quirks?: string[];
    /** The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing */
    preoccupations?: string[];
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
    /** How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says */
    storytelling?: 'never' | 'occasionally' | 'often';
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
    /** What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant */
    kind?: 'host' | 'caller';
    label: string;
    /** Completes "You are …". Who they ARE; the sheet below carries how they talk */
    style: string;
    /** The name this character goes by on air, overriding the station's own while it is active */
    djName?: string;
    /** The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default */
    voice?: string;
    /** The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word */
    soundboard?: string;
    /** The dialect: grammar and substitutions that apply to every sentence rather than to a subject */
    diction?: string[];
    /** Words whose presence proves the dialect survived. What a model's answer is checked against */
    dictionMarkers?: string[];
    /** What they always and never do on air */
    quirks?: string[];
    /** The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing */
    preoccupations?: string[];
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
    /** How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says */
    storytelling?: 'never' | 'occasionally' | 'often';
    /** Lines in their own voice, used as examples and as a console preview */
    samples?: string[];
    /** This character's own break phrasings, one per line. Empty means the station's global ones */
    templates?: string;
}

/**
 * A description of a character, in the operator's own words
 * generated from [PersonaRequest](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L37)
 */
export interface PersonaRequest {
    description: string;
}

/**
 * A persona as a form's contents rather than a row: no id and not on air, because nothing has been
 * saved. The console opens this in the editor and the operator saves it through POST /personas, which
 * is what keeps generating a way of filling in the form rather than a second writer of the table
 * generated from [PersonaDraftView](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L44)
 */
export interface PersonaDraftView {
    key: string;
    label: string;
    style: string;
    djName?: string;
    voice?: string;
    soundboard?: string;
    diction?: string[];
    dictionMarkers?: string[];
    quirks?: string[];
    preoccupations?: string[];
    catchphrases?: string[];
    avoid?: string[];
    background?: string;
    brevity?: 'short' | 'one-line';
    latitude?: 'loose' | 'unleashed';
    storytelling?: 'never' | 'occasionally' | 'often';
    samples?: string[];
    templates?: string;
}

/**
 * One thing this character has accumulated that its sheet does not hold. Two kinds and they are two
 * different claims: `said` records something it actually put on air and carries the script as its
 * evidence, so it is a record and goes straight into use; `trait` infers who the character is
 * becoming, which nothing can verify, so a model's arrives `suggested` and the operator is the check
 * generated from [PersonaNote](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L77)
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
 * generated from [PersonaNoteWrite](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L94)
 */
export interface PersonaNoteWrite {
    kind: 'said' | 'trait';
    note: string;
}

/**
 * Accepting a proposal, turning one down, or taking a note out of use without losing it
 * generated from [PersonaNoteState](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L99)
 */
export interface PersonaNoteState {
    state: 'active' | 'suggested' | 'rejected';
}

/**
 * One thing a story has picked up since it was written. A row rather than a rewrite, so an invented clause can be turned down without losing the story
 * generated from [PersonaStoryDetail](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L120)
 */
export interface PersonaStoryDetail {
    id: string;
    detail: string;
    state: 'active' | 'suggested' | 'rejected';
    origin: 'operator' | 'model';
    source?: string;
    createdAt: string;
}

export interface PersonaStoryDetailInput {
    detail: string;
}

/**
 * A story an operator is writing by hand. Always active and always theirs; a proposal is something only the enrichment pass creates
 * generated from [PersonaStoryWrite](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L134)
 */
export interface PersonaStoryWrite {
    title: string;
    story: string;
}

/**
 * One thing to add to a story that already exists
 * generated from [PersonaStoryDetailWrite](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L139)
 */
export interface PersonaStoryDetailWrite {
    detail: string;
}

/**
 * Accepting a proposal, turning one down, or taking a story out of the rotation without losing it
 * generated from [PersonaStoryState](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L143)
 */
export interface PersonaStoryState {
    state: 'active' | 'suggested' | 'rejected';
}

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L150)
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
 * generated from [PersonaList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L32)
 */
export interface PersonaList {
    personas: Persona[];
}

export interface PersonaListInput {
    personas: PersonaInput[];
}

/**
 * One character's whole notebook, oldest first, in every state
 * generated from [PersonaNoteList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L89)
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
 * Something that happened to this character, in its own telling. Not a claim about the world and never
 * checked as one: `source` says where a proposal came from, for the operator reading it, and nothing
 * downstream reads it as evidence — see `persona.story.ts` for why that is the load-bearing difference
 * from a fact
 * generated from [PersonaStory](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L107)
 */
export interface PersonaStory {
    id: string;
    /** A short handle. Never spoken; what this list is read by and what a proposal names */
    title: string;
    /** The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands */
    story: string;
    /** `active` can be told. `rejected` outlives the pass that proposed it, or the same catalogue proposes it forever */
    state: 'active' | 'suggested' | 'rejected';
    /** Who says so. `model` is the enrichment pass writing from what the station already holds */
    origin: 'operator' | 'model';
    /** Where a proposal came from, in the station's own words. Absent for anything an operator wrote */
    source?: string;
    /** What it has picked up since, in every state */
    details: PersonaStoryDetail[];
    /** Absent means never told, which is what puts it at the front of the rotation */
    lastToldAt?: string;
    /** How often it has gone out, which changes how the model is asked to tell it */
    timesTold: number;
    createdAt: string;
}

export interface PersonaStoryInput {
    /** A short handle. Never spoken; what this list is read by and what a proposal names */
    title: string;
    /** The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands */
    story: string;
}

/**
 * What a model wrote, and what had to be dropped to make it usable
 * generated from [GeneratedPersona](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L66)
 */
export interface GeneratedPersona {
    persona: PersonaDraftView;
    /** A couple of things that have happened to this character. Beside the form rather than in it, because they are their own table: the console saves the persona and then writes these through the stories route, so they go through the same validation an operator's own typing does */
    stories: PersonaStoryWrite[];
    /** Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off */
    droppedMarkers: string[];
    /** Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings */
    droppedTemplates: string[];
}

/**
 * What a persona says when it is asked for a break it will never air
 * generated from [PersonaRehearsal](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L159)
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

/**
 * Every story one character holds, oldest first, in every state
 * generated from [PersonaStoryList](file://./../../../../../apps/api/data/contracts/personas/personas.types.ck#L129)
 */
export interface PersonaStoryList {
    personaId: string;
    stories: PersonaStory[];
}

export interface PersonaStoryListInput {
    personaId: string;
    stories: PersonaStoryInput[];
}
