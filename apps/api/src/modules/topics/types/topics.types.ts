import { z } from 'zod';
import { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * What a break can be about: a news category, and later a weather location. The operator's own vocabulary, per sort of break
 * generated from [Topic](../../../../data/contracts/topics/topics.types.ck#L8)
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
 * generated from [TopicKindDescriptor](../../../../data/contracts/topics/topics.types.ck#L22)
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
 * generated from [TopicQuery](../../../../data/contracts/topics/topics.types.ck#L34)
 */
export const TopicQuery = z.strictObject({
    kind: z.string().max(100).optional().describe('One sort of break, or absent for every subject this station has named'),
});
export type TopicQuery = z.infer<typeof TopicQuery>;

/**
 * generated from [TopicList](../../../../data/contracts/topics/topics.types.ck#L17)
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
 * generated from [TopicKindList](../../../../data/contracts/topics/topics.types.ck#L30)
 */
export const TopicKindList = z.strictObject({
    kinds: z.array(TopicKindDescriptor),
});
export type TopicKindList = z.infer<typeof TopicKindList>;
