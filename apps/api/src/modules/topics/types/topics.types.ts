import { z } from 'zod';
import { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * What a break can be about: a news category, and later a weather location. The operator's own vocabulary, per sort of break
 * generated from [Topic](../../../../data/contracts/topics/topics.types.ck)
 */
export const Topic = z.strictObject({
    id: z.string().min(1).max(100),
    kind: z.string().min(1).max(100).describe('Which sort of break this is a subject for, as `segments.kind` spells it'),
    key: z
        .string()
        .min(1)
        .max(100)
        .describe('A stable slug, unique within its kind. What the format clock points a band at and what a seeded topic is recognised by'),
    label: z.string().min(1).max(200).describe('What a break calls it out loud, so it is the phrasing you would want to hear'),
    config: z
        .record(z.string(), z.unknown())
        .describe("This sort of break's own settings for this subject, in the fields its kind declares. Nothing generic reads them"),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Your own order, for the list. Two subjects never contest anything, so it means nothing else'),
});
export type Topic = z.infer<typeof Topic>;

export const TopicInput = z.strictObject({
    kind: z.string().min(1).max(100).describe('Which sort of break this is a subject for, as `segments.kind` spells it'),
    key: z
        .string()
        .min(1)
        .max(100)
        .describe('A stable slug, unique within its kind. What the format clock points a band at and what a seeded topic is recognised by'),
    label: z.string().min(1).max(200).describe('What a break calls it out loud, so it is the phrasing you would want to hear'),
    config: z
        .record(z.string(), z.unknown())
        .describe("This sort of break's own settings for this subject, in the fields its kind declares. Nothing generic reads them"),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Your own order, for the list. Two subjects never contest anything, so it means nothing else'),
});
export type TopicInput = z.infer<typeof TopicInput>;

/**
 * A sort of break that has subjects at all, and how one of its subjects is edited. `ConfigFieldDescriptor` is the plugins area's, shared for the reason a station setting shares it: one form component renders them all
 * generated from [TopicKindDescriptor](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicKindDescriptor = z.strictObject({
    kind: z.string().min(1).max(100),
    nounOne: z.string().min(1).max(100).describe('What to call one of these: a news subject is a category and a weather subject is a location'),
    nounMany: z.string().min(1).max(100),
    description: z.string().max(2000),
    fields: z.array(ConfigFieldDescriptor),
});
export type TopicKindDescriptor = z.infer<typeof TopicKindDescriptor>;

/**
 * generated from [TopicQuery](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicQuery = z.strictObject({
    kind: z.string().max(100).optional().describe('One sort of break, or absent for every subject this station has named'),
});
export type TopicQuery = z.infer<typeof TopicQuery>;

/**
 * One subject in a file. Nothing about the station it came from: no id, and no place in a list
 * generated from [TopicPackRow](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicPackRow = z.strictObject({
    kind: z.string().min(1).max(100).describe('Which sort of break this is a subject for'),
    key: z.string().min(1).max(100).describe('What identifies it within its kind, here and on the station it came from'),
    label: z.string().min(1).max(200).describe('What a break calls it out loud'),
    config: z.record(z.string(), z.unknown()).optional().describe("This sort of break's own settings for this subject"),
});
export type TopicPackRow = z.infer<typeof TopicPackRow>;

/**
 * A station's subjects as one file, to hand to another station. Each entry is read as a `TopicPackRow`
 * when it is imported, so one a station cannot use is reported rather than refusing the file
 * generated from [TopicPack](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicPack = z.strictObject({
    format: z.literal('deadair.topics').describe('Says the file is a topics file'),
    version: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .describe("The version of the document's shape. This station reads version 1"),
    name: z.string().min(1).max(100).describe('What the file is, as whoever made it would describe it'),
    topics: z.array(z.record(z.string(), z.unknown())).max(1000),
});
export type TopicPack = z.infer<typeof TopicPack>;

/**
 * An entry in a file that importing it would leave out, and why
 * generated from [PackImportDropped](../../../../data/contracts/topics/topics.types.ck)
 */
export const PackImportDropped = z.strictObject({
    entry: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .describe('Which entry in the file, counting from 1'),
    words: z.string().optional().describe('What the entry calls itself, when it does'),
    reason: z.string().describe('Why the station cannot use it'),
});
export type PackImportDropped = z.infer<typeof PackImportDropped>;

export const PackImportDroppedInput = z.strictObject({});
export type PackImportDroppedInput = z.infer<typeof PackImportDroppedInput>;

/**
 * Something to know about a file that does not stop it being imported, in the station's own sentence
 * generated from [PackImportNotice](../../../../data/contracts/topics/topics.types.ck)
 */
export const PackImportNotice = z.strictObject({
    kind: z.string().describe('What sort of notice, for a caller that treats one differently'),
    message: z.string(),
});
export type PackImportNotice = z.infer<typeof PackImportNotice>;

export const PackImportNoticeInput = z.strictObject({});
export type PackImportNoticeInput = z.infer<typeof PackImportNoticeInput>;

/**
 * generated from [TopicList](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicList = z.strictObject({
    topics: z.array(Topic),
});
export type TopicList = z.infer<typeof TopicList>;

export const TopicListInput = z.strictObject({
    topics: z.array(TopicInput),
});
export type TopicListInput = z.infer<typeof TopicListInput>;

/**
 * generated from [TopicKindList](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicKindList = z.strictObject({
    kinds: z.array(TopicKindDescriptor),
});
export type TopicKindList = z.infer<typeof TopicKindList>;

/**
 * What importing a file would do. The preview and the import reach it the same way, so what an operator was shown is what happens
 * generated from [PackImportPlan](../../../../data/contracts/topics/topics.types.ck)
 */
export const PackImportPlan = z.strictObject({
    name: z.string().describe('What the file says it is'),
    adding: z.array(z.string()).describe('What it would add, in the words a list would show'),
    skipped: z.array(z.string()).describe('What this station already has, which it would leave alone'),
    dropped: z.array(PackImportDropped).describe('What it cannot use'),
    notices: z.array(PackImportNotice),
});
export type PackImportPlan = z.infer<typeof PackImportPlan>;

export const PackImportPlanInput = z.strictObject({});
export type PackImportPlanInput = z.infer<typeof PackImportPlanInput>;

/**
 * What an import did, and the subjects as they now stand
 * generated from [TopicImportResult](../../../../data/contracts/topics/topics.types.ck)
 */
export const TopicImportResult = z.strictObject({
    plan: PackImportPlan,
    list: TopicList,
});
export type TopicImportResult = z.infer<typeof TopicImportResult>;

export const TopicImportResultInput = z.strictObject({});
export type TopicImportResultInput = z.infer<typeof TopicImportResultInput>;
