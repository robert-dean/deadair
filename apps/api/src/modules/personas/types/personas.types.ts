import { z } from 'zod';

/**
 * Who the station is when it opens its mouth: the character a model writes in, the phrasings underneath it, the voice that says them, and what it plays
 * generated from [Persona](file://./../../../../data/contracts/personas/personas.types.ck#L8)
 */
export const Persona = z.strictObject({
    id: z.string().min(1).max(100),
    key: z.string().min(1).max(100).describe('A stable slug, unique per station. What a log line names and what a seeded persona is recognised by'),
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
            "How much this character says. Absent for the station's ordinary length; there is no rung ABOVE it, because the word ceiling was measured and is not what bounds a break",
        ),
    samples: z.array(z.string().min(1).max(500)).optional().describe('Lines in their own voice, used as examples and as a console preview'),
    templates: z.string().max(20000).optional().describe("This character's own break phrasings, one per line. Empty means the station's global ones"),
    music: z.string().max(2000).optional().describe('What this persona plays, for the model that chooses records'),
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether this is the one on air. At most one per station'),
});
export type Persona = z.infer<typeof Persona>;

export const PersonaInput = z.strictObject({
    key: z.string().min(1).max(100).describe('A stable slug, unique per station. What a log line names and what a seeded persona is recognised by'),
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
            "How much this character says. Absent for the station's ordinary length; there is no rung ABOVE it, because the word ceiling was measured and is not what bounds a break",
        ),
    samples: z.array(z.string().min(1).max(500)).optional().describe('Lines in their own voice, used as examples and as a console preview'),
    templates: z.string().max(20000).optional().describe("This character's own break phrasings, one per line. Empty means the station's global ones"),
    music: z.string().max(2000).optional().describe('What this persona plays, for the model that chooses records'),
});
export type PersonaInput = z.infer<typeof PersonaInput>;

/**
 * A description of a character, in the operator's own words
 * generated from [PersonaRequest](file://./../../../../data/contracts/personas/personas.types.ck#L33)
 */
export const PersonaRequest = z.strictObject({
    description: z.string().min(1).max(2000),
});
export type PersonaRequest = z.infer<typeof PersonaRequest>;

/**
 * A persona as a form's contents rather than a row: no id and not on air, because nothing has been
 * saved. The console opens this in the editor and the operator saves it through POST /personas, which
 * is what keeps generating a way of filling in the form rather than a second writer of the table
 * generated from [PersonaDraftView](file://./../../../../data/contracts/personas/personas.types.ck#L40)
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
    samples: z.array(z.string().min(1).max(500)).optional(),
    templates: z.string().max(20000).optional(),
    music: z.string().max(2000).optional(),
});
export type PersonaDraftView = z.infer<typeof PersonaDraftView>;

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](file://./../../../../data/contracts/personas/personas.types.ck#L68)
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
 * generated from [PersonaList](file://./../../../../data/contracts/personas/personas.types.ck#L28)
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
 * What a model wrote, and what had to be dropped to make it usable
 * generated from [GeneratedPersona](file://./../../../../data/contracts/personas/personas.types.ck#L59)
 */
export const GeneratedPersona = z.strictObject({
    persona: PersonaDraftView,
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
 * generated from [PersonaRehearsal](file://./../../../../data/contracts/personas/personas.types.ck#L77)
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
