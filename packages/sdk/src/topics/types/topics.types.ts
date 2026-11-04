import type { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * What a break can be about: a news category, and later a weather location. The operator's own vocabulary, per sort of break
 * generated from [Topic](../../../../../apps/api/data/contracts/topics/topics.types.ck)
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
 * generated from [TopicKindDescriptor](../../../../../apps/api/data/contracts/topics/topics.types.ck)
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
 * generated from [TopicQuery](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface TopicQuery {
    /** One sort of break, or absent for every subject this station has named */
    kind?: string;
}

/**
 * One subject in a file. Nothing about the station it came from: no id, and no place in a list
 * generated from [TopicPackRow](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface TopicPackRow {
    /** Which sort of break this is a subject for */
    kind: string;
    /** What identifies it within its kind, here and on the station it came from */
    key: string;
    /** What a break calls it out loud */
    label: string;
    /** This sort of break's own settings for this subject */
    config?: Record<string, unknown>;
}

/**
 * A station's subjects as one file, to hand to another station. Each entry is read as a `TopicPackRow`
 * when it is imported, so one a station cannot use is reported rather than refusing the file
 * generated from [TopicPack](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface TopicPack {
    /** Says the file is a topics file */
    format: 'deadair.topics';
    /** The version of the document's shape. This station reads version 1 */
    version: number;
    /** What the file is, as whoever made it would describe it */
    name: string;
    topics: Record<string, unknown>[];
}

/**
 * An entry in a file that importing it would leave out, and why
 * generated from [PackImportDropped](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface PackImportDropped {
    /** Which entry in the file, counting from 1 */
    entry: number;
    /** What the entry calls itself, when it does */
    words?: string;
    /** Why the station cannot use it */
    reason: string;
}

export interface PackImportDroppedInput {}

/**
 * Something to know about a file that does not stop it being imported, in the station's own sentence
 * generated from [PackImportNotice](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface PackImportNotice {
    /** What sort of notice, for a caller that treats one differently */
    kind: string;
    message: string;
}

export interface PackImportNoticeInput {}

/**
 * generated from [TopicList](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface TopicList {
    topics: Topic[];
}

export interface TopicListInput {
    topics: TopicInput[];
}

/**
 * generated from [TopicKindList](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface TopicKindList {
    kinds: TopicKindDescriptor[];
}

/**
 * What importing a file would do. The preview and the import reach it the same way, so what an operator was shown is what happens
 * generated from [PackImportPlan](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface PackImportPlan {
    /** What the file says it is */
    name: string;
    /** What it would add, in the words a list would show */
    adding: string[];
    /** What this station already has, which it would leave alone */
    skipped: string[];
    /** What it cannot use */
    dropped: PackImportDropped[];
    notices: PackImportNotice[];
}

export interface PackImportPlanInput {}

/**
 * What an import did, and the subjects as they now stand
 * generated from [TopicImportResult](../../../../../apps/api/data/contracts/topics/topics.types.ck)
 */
export interface TopicImportResult {
    plan: PackImportPlan;
    list: TopicList;
}

export interface TopicImportResultInput {}
