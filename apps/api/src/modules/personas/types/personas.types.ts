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
    samples: z.array(z.string().min(1).max(500)).optional().describe('Lines in their own voice, used as examples and as a console preview'),
    templates: z.string().max(20000).optional().describe("This character's own break phrasings, one per line. Empty means the station's global ones"),
    music: z.string().max(2000).optional().describe('What this persona plays, for the model that chooses records'),
});
export type PersonaInput = z.infer<typeof PersonaInput>;

/**
 * generated from [PersonaList](file://./../../../../data/contracts/personas/personas.types.ck#L27)
 */
export const PersonaList = z.strictObject({
    personas: z.array(Persona),
});
export type PersonaList = z.infer<typeof PersonaList>;

export const PersonaListInput = z.strictObject({
    personas: z.array(PersonaInput),
});
export type PersonaListInput = z.infer<typeof PersonaListInput>;
