import type { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * What a break can be about: a news category, and later a weather location. The operator's own vocabulary, per sort of break
 * generated from [Topic](../../../../../apps/api/data/contracts/topics/topics.types.ck#L8)
 */
export interface Topic {
    id: string;
    /** Which sort of break this is a subject for, as `segments.kind` spells it */
    kind: string;
    /** A stable slug, unique within its kind. What the format clock points a band at and what a seeded topic is recognised by */
    key: string;
    /** What a break calls it out loud, so it is the phrasing you would want to hear */
    label: string;
    /** This sort of break's own settings for this subject, in the fields its kind declares. Nothing generic reads them */
    config: Record<string, unknown>;
    /** Your own order, for the list. Two subjects never contest anything, so it means nothing else */
    position: number;
}

export interface TopicInput {
    /** Which sort of break this is a subject for, as `segments.kind` spells it */
    kind: string;
    /** A stable slug, unique within its kind. What the format clock points a band at and what a seeded topic is recognised by */
    key: string;
    /** What a break calls it out loud, so it is the phrasing you would want to hear */
    label: string;
    /** This sort of break's own settings for this subject, in the fields its kind declares. Nothing generic reads them */
    config: Record<string, unknown>;
    /** Your own order, for the list. Two subjects never contest anything, so it means nothing else */
    position: number;
}

/**
 * A sort of break that has subjects at all, and how one of its subjects is edited. `ConfigFieldDescriptor` is the plugins area's, shared for the reason a station setting shares it: one form component renders them all
 * generated from [TopicKindDescriptor](../../../../../apps/api/data/contracts/topics/topics.types.ck#L22)
 */
export interface TopicKindDescriptor {
    kind: string;
    /** What to call one of these: a news subject is a category and a weather subject is a location */
    nounOne: string;
    nounMany: string;
    description: string;
    fields: ConfigFieldDescriptor[];
}

/**
 * generated from [TopicQuery](../../../../../apps/api/data/contracts/topics/topics.types.ck#L34)
 */
export interface TopicQuery {
    /** One sort of break, or absent for every subject this station has named */
    kind?: string;
}

/**
 * generated from [TopicList](../../../../../apps/api/data/contracts/topics/topics.types.ck#L17)
 */
export interface TopicList {
    topics: Topic[];
}

export interface TopicListInput {
    topics: TopicInput[];
}

/**
 * generated from [TopicKindList](../../../../../apps/api/data/contracts/topics/topics.types.ck#L30)
 */
export interface TopicKindList {
    kinds: TopicKindDescriptor[];
}
