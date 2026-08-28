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
    soundboard: z
        .string()
        .max(200)
        .optional()
        .describe(
            'The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word',
        ),
    diction: z
        .array(z.string().min(1).max(500))
        .optional()
        .describe('The dialect: grammar and substitutions that apply to every sentence rather than to a subject'),
    dictionMarkers: z
        .array(z.string().min(1).max(100))
        .optional()
        .describe("Words whose presence proves the dialect survived. What a model's answer is checked against"),
    quirks: z.array(z.string().min(1).max(500)).optional().describe('What they always and never do on air'),
    preoccupations: z
        .array(z.string().min(1).max(500))
        .optional()
        .describe(
            'The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing',
        ),
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
    chattiness: z
        .enum(['reserved', 'sparing', 'ordinary', 'chatty', 'relentless'])
        .optional()
        .describe(
            "How often this character talks, as a scale on the station's own interval between breaks. Absent is `ordinary`, which is that interval unchanged. The quietest rung is half as often and never silence: turning the station's breaks off is a station setting, and two switches for one thing can disagree",
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
    soundboard: z
        .string()
        .max(200)
        .optional()
        .describe(
            'The soundboard this character has to hand, as the name of a board in the pad library. Empty for a presenter who works without one. What reaches a model is the names of the pads on that board, never this word',
        ),
    diction: z
        .array(z.string().min(1).max(500))
        .optional()
        .describe('The dialect: grammar and substitutions that apply to every sentence rather than to a subject'),
    dictionMarkers: z
        .array(z.string().min(1).max(100))
        .optional()
        .describe("Words whose presence proves the dialect survived. What a model's answer is checked against"),
    quirks: z.array(z.string().min(1).max(500)).optional().describe('What they always and never do on air'),
    preoccupations: z
        .array(z.string().min(1).max(500))
        .optional()
        .describe(
            'The standing subjects they keep coming back to. Exactly ONE reaches any one break, chosen by rotation, which is what makes a character sound like it has things on its mind rather than one thing',
        ),
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
    chattiness: z
        .enum(['reserved', 'sparing', 'ordinary', 'chatty', 'relentless'])
        .optional()
        .describe(
            "How often this character talks, as a scale on the station's own interval between breaks. Absent is `ordinary`, which is that interval unchanged. The quietest rung is half as often and never silence: turning the station's breaks off is a station setting, and two switches for one thing can disagree",
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
 * generated from [PersonaRequest](file://./../../../../data/contracts/personas/personas.types.ck#L38)
 */
export const PersonaRequest = z.strictObject({
    description: z.string().min(1).max(2000),
});
export type PersonaRequest = z.infer<typeof PersonaRequest>;

/**
 * A persona as a form's contents rather than a row: no id and not on air, because nothing has been
 * saved. The console opens this in the editor and the operator saves it through POST /personas, which
 * is what keeps generating a way of filling in the form rather than a second writer of the table
 * generated from [PersonaDraftView](file://./../../../../data/contracts/personas/personas.types.ck#L45)
 */
export const PersonaDraftView = z.strictObject({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    style: z.string().min(1).max(2000),
    djName: z.string().max(200).optional(),
    voice: z.string().max(200).optional(),
    soundboard: z.string().max(200).optional(),
    diction: z.array(z.string().min(1).max(500)).optional(),
    dictionMarkers: z.array(z.string().min(1).max(100)).optional(),
    quirks: z.array(z.string().min(1).max(500)).optional(),
    preoccupations: z.array(z.string().min(1).max(500)).optional(),
    catchphrases: z.array(z.string().min(1).max(200)).optional(),
    avoid: z.array(z.string().min(1).max(200)).optional(),
    background: z.string().max(2000).optional(),
    brevity: z.enum(['short', 'one-line']).optional(),
    latitude: z.enum(['loose', 'unleashed']).optional(),
    chattiness: z.enum(['reserved', 'sparing', 'ordinary', 'chatty', 'relentless']).optional(),
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
 * generated from [PersonaNote](file://./../../../../data/contracts/personas/personas.types.ck#L79)
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
 * generated from [PersonaNoteWrite](file://./../../../../data/contracts/personas/personas.types.ck#L96)
 */
export const PersonaNoteWrite = z.strictObject({
    kind: z.enum(['said', 'trait']),
    note: z.string().min(1).max(500),
});
export type PersonaNoteWrite = z.infer<typeof PersonaNoteWrite>;

/**
 * Accepting a proposal, turning one down, or taking a note out of use without losing it
 * generated from [PersonaNoteState](file://./../../../../data/contracts/personas/personas.types.ck#L101)
 */
export const PersonaNoteState = z.strictObject({
    state: z.enum(['active', 'suggested', 'rejected']),
});
export type PersonaNoteState = z.infer<typeof PersonaNoteState>;

/**
 * One thing a story has picked up since it was written. A row rather than a rewrite, so an invented clause can be turned down without losing the story
 * generated from [PersonaStoryDetail](file://./../../../../data/contracts/personas/personas.types.ck#L122)
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
 * generated from [PersonaStoryWrite](file://./../../../../data/contracts/personas/personas.types.ck#L136)
 */
export const PersonaStoryWrite = z.strictObject({
    title: z.string().min(1).max(200),
    story: z.string().min(1).max(4000),
});
export type PersonaStoryWrite = z.infer<typeof PersonaStoryWrite>;

/**
 * One thing to add to a story that already exists
 * generated from [PersonaStoryDetailWrite](file://./../../../../data/contracts/personas/personas.types.ck#L141)
 */
export const PersonaStoryDetailWrite = z.strictObject({
    detail: z.string().min(1).max(1000),
});
export type PersonaStoryDetailWrite = z.infer<typeof PersonaStoryDetailWrite>;

/**
 * Accepting a proposal, turning one down, or taking a story out of the rotation without losing it
 * generated from [PersonaStoryState](file://./../../../../data/contracts/personas/personas.types.ck#L145)
 */
export const PersonaStoryState = z.strictObject({
    state: z.enum(['active', 'suggested', 'rejected']),
});
export type PersonaStoryState = z.infer<typeof PersonaStoryState>;

/**
 * One thing a story picked up after it was written, carried the same way and for the same reasons
 * generated from [PersonaFileStoryDetail](file://./../../../../data/contracts/personas/personas.types.ck#L178)
 */
export const PersonaFileStoryDetail = z.strictObject({
    detail: z.string().min(1).max(1000),
    state: z.enum(['active', 'rejected']).optional(),
});
export type PersonaFileStoryDetail = z.infer<typeof PersonaFileStoryDetail>;

/**
 * Something to know before pressing Import. Not a refusal: every one of these describes a state the
 * station can be in perfectly well, and the point of saying it is that each one is otherwise
 * discovered by putting the character on air
 * generated from [PersonaImportNotice](file://./../../../../data/contracts/personas/personas.types.ck#L226)
 */
export const PersonaImportNotice = z.strictObject({
    kind: z
        .enum(['format', 'duplicate', 'on-air', 'clears', 'voice', 'soundboard', 'phrasing', 'markers'])
        .describe('Which sort, so a console can group or ignore by it rather than parsing the sentence'),
    message: z.string().min(1).max(500).describe("The whole of it, in the station's own words, because its destination is a person"),
});
export type PersonaImportNotice = z.infer<typeof PersonaImportNotice>;

export const PersonaImportNoticeInput = z.strictObject({});
export type PersonaImportNoticeInput = z.infer<typeof PersonaImportNoticeInput>;

/**
 * One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
 * model that declined and a floor that covered for it are two facts, and the second on its own reads
 * as a station that never had a model configured
 * generated from [PersonaRehearsalAttempt](file://./../../../../data/contracts/personas/personas.types.ck#L243)
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
 * generated from [PersonaList](file://./../../../../data/contracts/personas/personas.types.ck#L33)
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
 * generated from [PersonaNoteList](file://./../../../../data/contracts/personas/personas.types.ck#L91)
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
 * generated from [PersonaStory](file://./../../../../data/contracts/personas/personas.types.ck#L109)
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
 * generated from [GeneratedPersona](file://./../../../../data/contracts/personas/personas.types.ck#L68)
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
 * Something that happened to this character, as a file carries it. No `origin` and no `source`,
 * unlike the stored row: whoever exported this stood behind every story in it, so on the far side
 * they are the receiving operator's own, and a sentence about where a proposal came from names a
 * catalogue that station does not have
 * generated from [PersonaFileStory](file://./../../../../data/contracts/personas/personas.types.ck#L171)
 */
export const PersonaFileStory = z.strictObject({
    title: z.string().min(1).max(200),
    story: z.string().min(1).max(4000),
    state: z
        .enum(['active', 'rejected'])
        .optional()
        .describe(
            'Absent means `active`. A turned-down story travels so the enrichment pass does not propose it again on the far side; an undecided one does not travel at all, because nobody has decided it yet',
        ),
    details: z.array(PersonaFileStoryDetail),
});
export type PersonaFileStory = z.infer<typeof PersonaFileStory>;

/**
 * One character in a file, and what would become of it here
 * generated from [PersonaImportEntry](file://./../../../../data/contracts/personas/personas.types.ck#L197)
 */
export const PersonaImportEntry = z.strictObject({
    key: z.string().min(1).max(100).describe('What identifies this character across two installs'),
    label: z.string().min(1).max(200),
    kind: z.enum(['host', 'caller']).optional(),
    outcome: z
        .enum(['create', 'update'])
        .describe(
            'Whether this station holds a character under this key already. An update rewrites the sheet and adds stories; it never deletes one the operator here wrote',
        ),
    storiesNew: z.coerce.number().int().min(0),
    storiesHeld: z.coerce.number().int().min(0).describe('Already here under the same handle, so importing would skip them'),
    detailsNew: z.coerce.number().int().min(0),
    detailsHeld: z.coerce.number().int().min(0),
    notices: z.array(PersonaImportNotice),
});
export type PersonaImportEntry = z.infer<typeof PersonaImportEntry>;

export const PersonaImportEntryInput = z.strictObject({});
export type PersonaImportEntryInput = z.infer<typeof PersonaImportEntryInput>;

/**
 * What a persona says when it is asked for a break it will never air
 * generated from [PersonaRehearsal](file://./../../../../data/contracts/personas/personas.types.ck#L252)
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
 * generated from [PersonaStoryList](file://./../../../../data/contracts/personas/personas.types.ck#L131)
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

/**
 * One character in a file. `PersonaDraftView` is the sheet with no id and not on air, which is
 * exactly what travels, plus the two fields a model is deliberately not asked for and a real install
 * always knows: what the character is FOR, and which rack it has to hand
 * generated from [PersonaFilePersona](file://./../../../../data/contracts/personas/personas.types.ck#L161)
 */
export const PersonaFilePersona = PersonaDraftView.extend({
    kind: z.enum(['host', 'caller']).optional().describe('Absent means `host`, as everywhere else'),
    soundboard: z
        .string()
        .max(200)
        .optional()
        .describe(
            'The board this character reaches for. Carried even though the receiving station may not hold it: a persona naming a rack that does not exist and one with no rack are the same state, and the import says which it got',
        ),
    stories: z.array(PersonaFileStory),
});
export type PersonaFilePersona = z.infer<typeof PersonaFilePersona>;

/**
 * What importing a file WOULD do, worked out against this station and written nowhere.
 *
 * The same code the import itself runs, so what this reports is what will happen rather than a second
 * opinion about it. It answers two questions an operator cannot get from the file alone: which
 * characters are new here and which would be rewritten, and what this station cannot honour about them
 * generated from [PersonaImportPlan](file://./../../../../data/contracts/personas/personas.types.ck#L188)
 */
export const PersonaImportPlan = z.strictObject({
    format: z
        .string()
        .min(1)
        .max(50)
        .describe(
            'What the file said it was. Reported rather than enforced: this repo edits migrations in place, so a version stamp cannot promise a shape, and the shapes are what was actually validated',
        ),
    station: z.string().max(100).optional().describe('The station it was taken from, when it said'),
    takenAt: z.string().max(40).optional().describe('When it was taken, when it said'),
    notices: z.array(PersonaImportNotice).describe('About the FILE rather than any one character in it'),
    personas: z.array(PersonaImportEntry),
});
export type PersonaImportPlan = z.infer<typeof PersonaImportPlan>;

export const PersonaImportPlanInput = z.strictObject({});
export type PersonaImportPlanInput = z.infer<typeof PersonaImportPlanInput>;

/**
 * A character as a file: everything somebody would have to send to put this presenter on another
 * station, and nothing that belongs to the station it came from
 * generated from [PersonaFile](file://./../../../../data/contracts/personas/personas.types.ck#L151)
 */
export const PersonaFile = z.strictObject({
    format: z
        .string()
        .min(1)
        .max(50)
        .describe(
            'What shape this is, so a file from a later build says so rather than being read wrongly. The shapes below are what an import actually validates; this is for the human reading the failure',
        ),
    takenAt: z.string().min(1).max(40).describe('When it was exported, ISO-8601'),
    station: z
        .string()
        .max(100)
        .optional()
        .describe(
            'The station it was taken from. Provenance only: an import writes into whichever station it is running as, and the two need not match',
        ),
    personas: z.array(PersonaFilePersona),
});
export type PersonaFile = z.infer<typeof PersonaFile>;

/**
 * What importing actually did, with the plan it did it from.
 *
 * All or nothing: a file whose import failed part-way leaves the station exactly as it was, on
 * `PUT /settings`' own rule. The preview is what stands between an operator and a surprise, so a
 * partial landing would be the one outcome nothing had described
 * generated from [PersonaImportResult](file://./../../../../data/contracts/personas/personas.types.ck#L214)
 */
export const PersonaImportResult = z.strictObject({
    plan: PersonaImportPlan.describe('What it decided to do, notices and all, so the answer carries its own explanation'),
    created: z.coerce.number().int().min(0),
    updated: z.coerce
        .number()
        .int()
        .min(0)
        .describe(
            'Characters whose sheet was rewritten. An update replaces the sheet and ADDS stories; it never deletes one the operator here wrote',
        ),
    storiesWritten: z.coerce.number().int().min(0),
    detailsWritten: z.coerce.number().int().min(0),
    personas: PersonaList.describe(
        "The roster as it now stands, on this file's own rule: every mutation answers the whole list, because more than the named row can change",
    ),
});
export type PersonaImportResult = z.infer<typeof PersonaImportResult>;

export const PersonaImportResultInput = z.strictObject({});
export type PersonaImportResultInput = z.infer<typeof PersonaImportResultInput>;
