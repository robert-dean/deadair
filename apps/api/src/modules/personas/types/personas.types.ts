import { z } from 'zod';

/**
 * Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
 * generated from [Persona](file://./../../../../data/contracts/personas/personas.types.ck#L8)
 */
export const Persona = z.strictObject({
    id: z.string().min(1).max(100),
    key: z.string().min(1).max(100).describe('A stable slug, unique per station. What a log line names and what a seeded persona is recognised by'),
    kind: z
        .enum(['host', 'caller'])
        .optional()
        .describe(
            "What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant",
        ),
    label: z.string().min(1).max(200),
    style: z.string().min(1).max(2000).describe('Completes "You are …". Who they ARE; the sheet below carries how they talk'),
    djName: z.string().max(200).optional().describe("The name this character goes by on air, overriding the station's own while it is active"),
    voice: z
        .string()
        .max(200)
        .optional()
        .describe("The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default"),
    diction: z
        .array(z.string().min(1).max(500))
        .optional()
        .describe('The dialect: grammar and substitutions that apply to every sentence rather than to a subject'),
    dictionMarkers: z
        .array(z.string().min(1).max(100))
        .optional()
        .describe("Words whose presence proves the dialect survived. What a model's answer is checked against"),
    quirks: z.array(z.string().min(1).max(500)).optional().describe('What they always and never do on air'),
    catchphrases: z.array(z.string().min(1).max(200)).optional().describe('Signature phrases, asked for sparingly'),
    avoid: z.array(z.string().min(1).max(200)).optional().describe('Wording that breaks the character'),
    background: z.string().max(2000).optional().describe('A couple of grounded facts they may self-reference'),
    brevity: z
        .enum(['short', 'one-line'])
        .optional()
        .describe(
            "How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one",
        ),
    latitude: z
        .enum(['loose', 'unleashed'])
        .optional()
        .describe(
            "How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal",
        ),
    storytelling: z
        .enum(['never', 'occasionally', 'often'])
        .optional()
        .describe(
            'How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says',
        ),
    samples: z.array(z.string().min(1).max(500)).optional().describe('Lines in their own voice, used as examples and as a console preview'),
    templates: z.string().max(20000).optional().describe("This character's own break phrasings, one per line. Empty means the station's global ones"),
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether this is the one on air. At most one per station'),
});
export type Persona = z.infer<typeof Persona>;

export const PersonaInput = z.strictObject({
    key: z.string().min(1).max(100).describe('A stable slug, unique per station. What a log line names and what a seeded persona is recognised by'),
    kind: z
        .enum(['host', 'caller'])
        .optional()
        .describe(
            "What this character is FOR. `host` is the station's own voice; a `caller` phones in to a production, is cast per programme, and can never be put on air. Absent means `host`, so a form written before callers existed still means what it meant",
        ),
    label: z.string().min(1).max(200),
    style: z.string().min(1).max(2000).describe('Completes "You are …". Who they ARE; the sheet below carries how they talk'),
    djName: z.string().max(200).optional().describe("The name this character goes by on air, overriding the station's own while it is active"),
    voice: z
        .string()
        .max(200)
        .optional()
        .describe("The station voice that speaks this persona, as the id a speech plugin maps. Empty means that plugin's default"),
    diction: z
        .array(z.string().min(1).max(500))
        .optional()
        .describe('The dialect: grammar and substitutions that apply to every sentence rather than to a subject'),
    dictionMarkers: z
        .array(z.string().min(1).max(100))
        .optional()
        .describe("Words whose presence proves the dialect survived. What a model's answer is checked against"),
    quirks: z.array(z.string().min(1).max(500)).optional().describe('What they always and never do on air'),
    catchphrases: z.array(z.string().min(1).max(200)).optional().describe('Signature phrases, asked for sparingly'),
    avoid: z.array(z.string().min(1).max(200)).optional().describe('Wording that breaks the character'),
    background: z.string().max(2000).optional().describe('A couple of grounded facts they may self-reference'),
    brevity: z
        .enum(['short', 'one-line'])
        .optional()
        .describe(
            "How much this character says. Absent for the station's ordinary length; the rung above it is `latitude`, which is a different kind of thing rather than a longer one",
        ),
    latitude: z
        .enum(['loose', 'unleashed'])
        .optional()
        .describe(
            "How much room this character is given, above the station's ordinary discipline: a bigger word ceiling, a licence to follow the thought instead of making one point, and at `unleashed` no restraint on how it says it. Offered only by the ordinary talk break, always outranked by the station's content policy, and it switches off no refusal",
        ),
    storytelling: z
        .enum(['never', 'occasionally', 'often'])
        .optional()
        .describe(
            'How readily this character works one of its own stories into an ordinary talk break. Absent is `occasionally`, which offers one only where the station knows nothing about the records either side. The stories themselves are their own list, and a `story` band on the clock outranks this whatever it says',
        ),
    samples: z.array(z.string().min(1).max(500)).optional().describe('Lines in their own voice, used as examples and as a console preview'),
    templates: z.string().max(20000).optional().describe("This character's own break phrasings, one per line. Empty means the station's global ones"),
});
export type PersonaInput = z.infer<typeof PersonaInput>;

/**
 * A description of a character, in the operator's own words
 * generated from [PersonaRequest](file://./../../../../data/contracts/personas/personas.types.ck#L35)
 */
export const PersonaRequest = z.strictObject({
    description: z.string().min(1).max(2000),
});
export type PersonaRequest = z.infer<typeof PersonaRequest>;

/**
 * A persona as a form's contents rather than a row: no id and not on air, because nothing has been
 * saved. The console opens this in the editor and the operator saves it through POST /personas, which
 * is what keeps generating a way of filling in the form rather than a second writer of the table
 * generated from [PersonaDraftView](file://./../../../../data/contracts/personas/personas.types.ck#L42)
 */
export const PersonaDraftView = z.strictObject({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    style: z.string().min(1).max(2000),
    djName: z.string().max(200).optional(),
    voice: z.string().max(200).optional(),
    diction: z.array(z.string().min(1).max(500)).optional(),
    dictionMarkers: z.array(z.string().min(1).max(100)).optional(),
    quirks: z.array(z.string().min(1).max(500)).optional(),
    catchphrases: z.array(z.string().min(1).max(200)).optional(),
    avoid: z.array(z.string().min(1).max(200)).optional(),
    background: z.string().max(2000).optional(),
    brevity: z.enum(['short', 'one-line']).optional(),
    latitude: z.enum(['loose', 'unleashed']).optional(),
    storytelling: z.enum(['never', 'occasionally', 'often']).optional(),
    samples: z.array(z.string().min(1).max(500)).optional(),
    templates: z.string().max(20000).optional(),
});
export type PersonaDraftView = z.infer<typeof PersonaDraftView>;

/**
 * One thing this character has accumulated that its sheet does not hold. Two kinds and they are two
 * different claims: `said` records something it actually put on air and carries the script as its
 * evidence, so it is a record and goes straight into use; `trait` infers who the character is
 * becoming, which nothing can verify, so a model's arrives `suggested` and the operator is the check
 * generated from [PersonaNote](file://./../../../../data/contracts/personas/personas.types.ck#L73)
 */
export const PersonaNote = z.strictObject({
    id: z.string().min(1).max(100),
    kind: z
        .enum(['said', 'trait'])
        .describe("`said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet"),
    note: z.string().min(1).max(500).describe('One sentence, because it shares a system turn with the grounding rules'),
    state: z
        .enum(['active', 'suggested', 'rejected'])
        .describe('`active` is carried into breaks. `rejected` outlives the pass that proposed it, or the same scripts propose it again forever'),
    origin: z.enum(['operator', 'model']).describe("Who says so. `model` is the distil pass reading this character's own history back"),
    sourceScriptId: z
        .string()
        .max(100)
        .optional()
        .describe('The attempt this was drawn from, while that row still exists. The nightly sweep takes it and the quote below stays'),
    sourceQuote: z
        .string()
        .max(2000)
        .optional()
        .describe(
            'The words that support it, as the station said them. What an operator actually accepts or rejects on, and required of anything a model wrote',
        ),
    lastUsedAt: z
        .string()
        .max(40)
        .optional()
        .describe('When it was last carried into a break. Absent means never, which is what puts it at the front of the rotation'),
    createdAt: z.string().min(1).max(40),
});
export type PersonaNote = z.infer<typeof PersonaNote>;

export const PersonaNoteInput = z.strictObject({
    kind: z
        .enum(['said', 'trait'])
        .describe("`said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet"),
    note: z.string().min(1).max(500).describe('One sentence, because it shares a system turn with the grounding rules'),
});
export type PersonaNoteInput = z.infer<typeof PersonaNoteInput>;

/**
 * A note an operator is writing by hand. Always active and always theirs; a proposal is something only the distil pass creates
 * generated from [PersonaNoteWrite](file://./../../../../data/contracts/personas/personas.types.ck#L90)
 */
export const PersonaNoteWrite = z.strictObject({
    kind: z.enum(['said', 'trait']),
    note: z.string().min(1).max(500),
});
export type PersonaNoteWrite = z.infer<typeof PersonaNoteWrite>;

/**
 * Accepting a proposal, turning one down, or taking a note out of use without losing it
 * generated from [PersonaNoteState](file://./../../../../data/contracts/personas/personas.types.ck#L95)
 */
export const PersonaNoteState = z.strictObject({
    state: z.enum(['active', 'suggested', 'rejected']),
});
export type PersonaNoteState = z.infer<typeof PersonaNoteState>;

/**
 * One thing a story has picked up since it was written. A row rather than a rewrite, so an invented clause can be turned down without losing the story
 * generated from [PersonaStoryDetail](file://./../../../../data/contracts/personas/personas.types.ck#L116)
 */
export const PersonaStoryDetail = z.strictObject({
    id: z.string().min(1).max(100),
    detail: z.string().min(1).max(1000),
    state: z.enum(['active', 'suggested', 'rejected']),
    origin: z.enum(['operator', 'model']),
    source: z.string().max(1000).optional(),
    createdAt: z.string().min(1).max(40),
});
export type PersonaStoryDetail = z.infer<typeof PersonaStoryDetail>;

export const PersonaStoryDetailInput = z.strictObject({
    detail: z.string().min(1).max(1000),
});
export type PersonaStoryDetailInput = z.infer<typeof PersonaStoryDetailInput>;

/**
 * A story an operator is writing by hand. Always active and always theirs; a proposal is something only the enrichment pass creates
 * generated from [PersonaStoryWrite](file://./../../../../data/contracts/personas/personas.types.ck#L130)
 */
export const PersonaStoryWrite = z.strictObject({
    title: z.string().min(1).max(200),
    story: z.string().min(1).max(4000),
});
export type PersonaStoryWrite = z.infer<typeof PersonaStoryWrite>;

/**
 * One thing to add to a story that already exists
 * generated from [PersonaStoryDetailWrite](file://./../../../../data/contracts/personas/personas.types.ck#L135)
 */
export const PersonaStoryDetailWrite = z.strictObject({
    detail: z.string().min(1).max(1000),
});
export type PersonaStoryDetailWrite = z.infer<typeof PersonaStoryDetailWrite>;

/**
 * Accepting a proposal, turning one down, or taking a story out of the rotation without losing it
 * generated from [PersonaStoryState](file://./../../../../data/contracts/personas/personas.types.ck#L139)
 */
export const PersonaStoryState = z.strictObject({
    state: z.enum(['active', 'suggested', 'rejected']),
});
export type PersonaStoryState = z.infer<typeof PersonaStoryState>;

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](file://./../../../../data/contracts/personas/personas.types.ck#L146)
 */
export const PersonaRehearsalAttempt = z.strictObject({
    writer: z.string().min(1).max(100).describe('Which binding was asked, as `segments.writer` would record it'),
    outcome: z.string().min(1).max(20).describe('written, declined or failed. Declined is the station working; failed is something to go and fix'),
    durationMs: z.coerce
        .number()
        .int()
        .min(0)
        .describe(
            'Kept for every writer rather than only a slow one: "the model got slower" can only be asked of numbers gathered before anybody suspected it',
        ),
    script: z.string().max(5000).optional().describe('What it produced, when it produced anything usable'),
    reason: z.string().max(1000).optional().describe('Why it did not, when it did not. A sentence, because its destination is a person'),
});
export type PersonaRehearsalAttempt = z.infer<typeof PersonaRehearsalAttempt>;

/**
 * generated from [PersonaList](file://./../../../../data/contracts/personas/personas.types.ck#L30)
 */
export const PersonaList = z.strictObject({
    personas: z.array(Persona),
});
export type PersonaList = z.infer<typeof PersonaList>;

export const PersonaListInput = z.strictObject({
    personas: z.array(PersonaInput),
});
export type PersonaListInput = z.infer<typeof PersonaListInput>;

/**
 * One character's whole notebook, oldest first, in every state
 * generated from [PersonaNoteList](file://./../../../../data/contracts/personas/personas.types.ck#L85)
 */
export const PersonaNoteList = z.strictObject({
    personaId: z.string().min(1).max(100),
    notes: z.array(PersonaNote),
});
export type PersonaNoteList = z.infer<typeof PersonaNoteList>;

export const PersonaNoteListInput = z.strictObject({
    personaId: z.string().min(1).max(100),
    notes: z.array(PersonaNoteInput),
});
export type PersonaNoteListInput = z.infer<typeof PersonaNoteListInput>;

/**
 * Something that happened to this character, in its own telling. Not a claim about the world and never
 * checked as one: `source` says where a proposal came from, for the operator reading it, and nothing
 * downstream reads it as evidence — see `persona.story.ts` for why that is the load-bearing difference
 * from a fact
 * generated from [PersonaStory](file://./../../../../data/contracts/personas/personas.types.ck#L103)
 */
export const PersonaStory = z.strictObject({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(200).describe('A short handle. Never spoken; what this list is read by and what a proposal names'),
    story: z
        .string()
        .min(1)
        .max(4000)
        .describe("The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands"),
    state: z
        .enum(['active', 'suggested', 'rejected'])
        .describe('`active` can be told. `rejected` outlives the pass that proposed it, or the same catalogue proposes it forever'),
    origin: z.enum(['operator', 'model']).describe('Who says so. `model` is the enrichment pass writing from what the station already holds'),
    source: z.string().max(1000).optional().describe("Where a proposal came from, in the station's own words. Absent for anything an operator wrote"),
    details: z.array(PersonaStoryDetail).describe('What it has picked up since, in every state'),
    lastToldAt: z.string().max(40).optional().describe('Absent means never told, which is what puts it at the front of the rotation'),
    timesTold: z.coerce.number().int().min(0).describe('How often it has gone out, which changes how the model is asked to tell it'),
    createdAt: z.string().min(1).max(40),
});
export type PersonaStory = z.infer<typeof PersonaStory>;

export const PersonaStoryInput = z.strictObject({
    title: z.string().min(1).max(200).describe('A short handle. Never spoken; what this list is read by and what a proposal names'),
    story: z
        .string()
        .min(1)
        .max(4000)
        .describe("The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands"),
});
export type PersonaStoryInput = z.infer<typeof PersonaStoryInput>;

/**
 * What a model wrote, and what had to be dropped to make it usable
 * generated from [GeneratedPersona](file://./../../../../data/contracts/personas/personas.types.ck#L62)
 */
export const GeneratedPersona = z.strictObject({
    persona: PersonaDraftView,
    stories: z
        .array(PersonaStoryWrite)
        .describe(
            "A couple of things that have happened to this character. Beside the form rather than in it, because they are their own table: the console saves the persona and then writes these through the stories route, so they go through the same validation an operator's own typing does",
        ),
    droppedMarkers: z
        .array(z.string().min(1).max(100))
        .describe(
            'Words the model called markers that its own sample lines never used. Dropped, because the samples are the evidence and the marker list is the claim — a marker nothing says declines every break and looks exactly like a model that is switched off',
        ),
    droppedTemplates: z
        .array(z.string().min(1).max(500))
        .describe(
            'Phrasings naming a value the vocabulary does not have. Dropped by the LINE, since five good phrasings and one broken one is five phrasings',
        ),
});
export type GeneratedPersona = z.infer<typeof GeneratedPersona>;

/**
 * What a persona says when it is asked for a break it will never air
 * generated from [PersonaRehearsal](file://./../../../../data/contracts/personas/personas.types.ck#L155)
 */
export const PersonaRehearsal = z.strictObject({
    personaId: z.string().min(1).max(100),
    previous: z.string().min(1).max(500).describe('The invented record the break follows. Fixed, so two readings of the same sheet can be compared'),
    next: z.string().min(1).max(500).describe('The invented record it leads into'),
    attempts: z.array(PersonaRehearsalAttempt),
    script: z.string().max(5000).optional().describe('The words a listener would have heard, from whichever writer answered first'),
    writer: z.string().min(1).max(100).optional().describe('Which one that was. Present exactly when `script` is'),
    reason: z
        .string()
        .max(1000)
        .optional()
        .describe('Why there are no words, when every writer had nothing. Not a fault: a break nothing could write is one the station does not take'),
});
export type PersonaRehearsal = z.infer<typeof PersonaRehearsal>;

/**
 * Every story one character holds, oldest first, in every state
 * generated from [PersonaStoryList](file://./../../../../data/contracts/personas/personas.types.ck#L125)
 */
export const PersonaStoryList = z.strictObject({
    personaId: z.string().min(1).max(100),
    stories: z.array(PersonaStory),
});
export type PersonaStoryList = z.infer<typeof PersonaStoryList>;

export const PersonaStoryListInput = z.strictObject({
    personaId: z.string().min(1).max(100),
    stories: z.array(PersonaStoryInput),
});
export type PersonaStoryListInput = z.infer<typeof PersonaStoryListInput>;
