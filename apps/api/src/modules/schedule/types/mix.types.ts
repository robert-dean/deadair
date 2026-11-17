import { z } from 'zod';

/**
 * A wire from one node's output to another node's input, by socket number from 0
 * generated from [MixLink](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixLink = z.strictObject({
    from: z.string().min(1).max(40).describe('The node the wire leaves'),
    out: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(9))
        .describe(
            'Which of its outputs: 0 for every node but a `split`, whose outputs are its branches in order and then "everything else". Each output takes one wire, and every record output has to lead somewhere: a loose one would drop records without a word',
        ),
    to: z.string().min(1).max(40).describe('The node the wire enters'),
    in: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(9))
        .describe(
            "Which of its inputs: 0 is records for every node but `merge`, whose four inputs are 0 to 3 and take as many wires as reach them; a `limitShare`'s input 1 takes a number, from a `timeSwitch`, in place of its own `percent`",
        ),
});
export type MixLink = z.infer<typeof MixLink>;

/**
 * One output of a `split`
 * generated from [MixBranch](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixBranch = z.strictObject({
    values: z
        .array(z.string().min(1).max(200))
        .max(20)
        .optional()
        .describe(
            'What it matches, for `genre`, `lastGenre` (a genre or anything refining it), `artist` and `judged` (`yes` or `no`); a decade as `1980`',
        ),
    min: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0).max(100))
        .optional()
        .describe('The lowest it matches, for `hour` and `showProgress`, inclusive'),
    max: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0).max(100))
        .optional()
        .describe('The highest, exclusive'),
});
export type MixBranch = z.infer<typeof MixBranch>;

/**
 * A record a `require` node may add
 * generated from [MixSong](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixSong = z.strictObject({
    title: z.string().min(1).max(500),
    artist: z.string().min(1).max(500).describe('Who made it: a record is found by title and artist together'),
});
export type MixSong = z.infer<typeof MixSong>;

/**
 * One answer to a question a draft asked
 * generated from [MixDraftAnswer](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixDraftAnswer = z.strictObject({
    question: z.string().min(1).max(300).describe('The question, as the draft asked it'),
    answer: z.string().min(1).max(200).describe('What the operator chose or wrote'),
});
export type MixDraftAnswer = z.infer<typeof MixDraftAnswer>;

/**
 * One phrase of a brief and what the draft made of it
 * generated from [MixDraftReading](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixDraftReading = z.strictObject({
    quote: z.string().max(200).describe('The phrase, as the brief has it'),
    note: z.string().max(300).describe('What it became, in plain words, or why it became nothing'),
    nodeIds: z
        .array(z.string().min(1).max(40))
        .max(8)
        .optional()
        .describe('The nodes drawn from it. Absent for a phrase about taste, which is left to the picks'),
    question: z
        .string()
        .max(300)
        .optional()
        .describe('Asked when the phrase could mean more than one thing. The draft made its best guess, and answering redrafts it'),
    options: z.array(z.string().min(1).max(200)).max(6).optional().describe('Answers to offer for `question`'),
});
export type MixDraftReading = z.infer<typeof MixDraftReading>;

/**
 * One node on the canvas. `kind` says what it is and which of the fields beside it count
 * generated from [MixNode](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixNode = z.strictObject({
    id: z.string().min(1).max(40).describe('Unique in the flow'),
    kind: z
        .enum(['picks', 'onAir', 'block', 'split', 'limitShare', 'limitCount', 'noRepeat', 'merge', 'require', 'timeSwitch'])
        .describe(
            '`picks` is what the station proposes and `onAir` what may air. `block` keeps the named bands off. `split` sends each record down the first branch it matches. `limitShare` and `limitCount` hold records past an amount of what has passed through them. `noRepeat` holds a record when the last record aired also passed through it. `merge` joins wires. `require` adds a record when due. `timeSwitch` is a number that changes at an hour',
        ),
    bands: z.array(z.string().min(1).max(200)).max(50).optional().describe('`block`: the bands it keeps off, matched by name, ignoring case'),
    splitBy: z
        .enum(['genre', 'artist', 'decade', 'hour', 'showProgress', 'lastGenre', 'judged'])
        .optional()
        .describe(
            '`split`: what it reads. `genre` is the band\'s main genre, which matches a branch\'s value or anything that refines it, so "black metal" takes "Norwegian black metal". `hour` and `showProgress` (a percent of the show) match a branch\'s range. `judged` is the model\'s stored answer to `question`, yes or no, asked once per record and kept; a record not answered yet is held at the split and waits a refill while the model is asked',
        ),
    branches: z.array(MixBranch).max(8).optional().describe('`split`: its outputs in order, before the last output, "everything else"'),
    question: z.string().min(1).max(200).optional().describe('`split` by `judged`: what the model is asked about each record, once'),
    percent: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0).max(100))
        .optional()
        .describe(
            '`limitShare`: at most this percent of the counted records in each `per` may pass through it. A number wired into its input 1 wins over this',
        ),
    count: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(1000))
        .optional()
        .describe('`limitCount`: at most this many records in each `per` may pass through it'),
    per: z.enum(['show', 'hour']).optional().describe('`limitShare` and `limitCount`: what the amount is counted over. Absent is `show`'),
    requireGenres: z.array(z.string().min(1).max(100)).max(4).optional().describe('`require`: the main genres that satisfy it'),
    requireMode: z
        .enum(['any', 'each'])
        .optional()
        .describe(
            '`require`: `any` is due until one record of any of `requireGenres` has aired in the show, `each` until one of each has. Absent is `any`',
        ),
    songs: z
        .array(MixSong)
        .max(20)
        .optional()
        .describe('`require`: the records it adds, the one aired longest ago first. Absent or empty adds a library record of a required genre'),
    afterPercent: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0).max(100))
        .optional()
        .describe('`require`: not due before this percent of the show has gone. Absent is 0'),
    fromHour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(23))
        .optional()
        .describe("`timeSwitch`: the hour on the station's clock it changes at"),
    thenValue: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0).max(1000))
        .optional()
        .describe('`timeSwitch`: its value from `fromHour` to the end of the show'),
    elseValue: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().min(0).max(1000))
        .optional()
        .describe('`timeSwitch`: its value before `fromHour`'),
    fromBrief: z.string().max(200).optional().describe('The phrase of the brief this node was drafted from, shown on the canvas. Nothing reads it'),
    x: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .optional()
        .describe('Where the canvas draws it. Nothing else reads it'),
    y: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()).optional(),
});
export type MixNode = z.infer<typeof MixNode>;

/**
 * What a show's mix flow is drafted from: the show's brief as the operator has it now, saved or not, and any answers to the questions an earlier draft asked
 * generated from [MixFlowDraftRequest](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixFlowDraftRequest = z.strictObject({
    brief: z.string().min(1).max(500).describe("The show's brief, in the operator's own words"),
    answers: z
        .array(MixDraftAnswer)
        .max(10)
        .optional()
        .describe('Answers to the questions an earlier draft of the same brief asked, so the next one can settle them'),
});
export type MixFlowDraftRequest = z.infer<typeof MixFlowDraftRequest>;

/**
 * A show's mix flow: nodes and the wires between them, as the console's canvas draws them. Records enter at the one `picks` node and leave at the one `onAir` node; a record the station proposes is followed down the wires, and the first node that holds it (a `block`, or a limit it would take past its amount) keeps it off the air. `require` nodes add a record when they fall due. A record a listener asked for, and what follows it, is never judged and never counted
 * generated from [MixFlow](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixFlow = z.strictObject({
    version: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(1))
        .describe('The shape of this document. 1'),
    nodes: z.array(MixNode).max(64),
    links: z.array(MixLink).max(128).describe('The wires'),
});
export type MixFlow = z.infer<typeof MixFlow>;

/**
 * A mix flow the station's model drafted from a brief, and what it made of each phrase. Nothing is saved: the operator looks it over on the canvas and saves it with the show as usual
 * generated from [MixFlowDraft](../../../../data/contracts/schedule/mix.types.ck)
 */
export const MixFlowDraft = z.strictObject({
    flow: MixFlow.describe('The drafted flow, laid out for the canvas. It passes the same check a saved flow does'),
    readings: z.array(MixDraftReading).max(40).describe('Each phrase of the brief the model read, and what became of it'),
    model: z.string().optional().describe('The model that drafted it'),
});
export type MixFlowDraft = z.infer<typeof MixFlowDraft>;
