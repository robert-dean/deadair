import type { PackImportPlan } from '../../topics/types/topics.types.js';

/**
 * One rule on the station's format clock: a sort of break, and when it happens
 * generated from [ClockBand](../../../../../apps/api/data/contracts/director/clock.types.ck)
 */
export interface ClockBand {
    id: string;
    /** Which sort of break this slot wants, as `segments.kind` spells it. Free text: a station that wants sponsor spots writes `sponsor` and drops the recordings in */
    kind: string;
    /** `clock` is a time of day and `interval` is a spacing rule for a kind the station's own interval does not cover */
    at: 'clock' | 'interval';
    /** For a `clock` band: the hour it happens at. Absent means every hour, which is the common case */
    hour?: number;
    /** For a `clock` band: minutes past the hour */
    minute?: number;
    /** For a `clock` band: the weekdays it happens on, Sunday 0, on the station's own clock. Absent or empty means every day */
    days?: number[];
    /** For a `clock` band: airs at its time exactly and never before it, waiting when the order comes up early and cutting the record in the way when it runs late. Absent or false is a soft marker, which airs at the first boundary after its time */
    hard?: boolean;
    /** For an `interval` band: how far apart, in milliseconds */
    everyMs?: number;
    /** Where this sits in the operator's own order, which is what settles a boundary two rules both want */
    position: number;
    /** A rule turned off without being lost */
    enabled: boolean;
    /** What this band is about, as a subject of its own kind: a news category, later a weather location. Absent means it covers whatever it finds */
    topicId?: string;
    /** That subject's name, so a list can be drawn without a second call */
    topicLabel?: string;
}

export interface ClockBandInput {
    /** Which sort of break this slot wants, as `segments.kind` spells it. Free text: a station that wants sponsor spots writes `sponsor` and drops the recordings in */
    kind: string;
    /** `clock` is a time of day and `interval` is a spacing rule for a kind the station's own interval does not cover */
    at: 'clock' | 'interval';
    /** For a `clock` band: the hour it happens at. Absent means every hour, which is the common case */
    hour?: number;
    /** For a `clock` band: minutes past the hour */
    minute?: number;
    /** For a `clock` band: the weekdays it happens on, Sunday 0, on the station's own clock. Absent or empty means every day */
    days?: number[];
    /** For a `clock` band: airs at its time exactly and never before it, waiting when the order comes up early and cutting the record in the way when it runs late. Absent or false is a soft marker, which airs at the first boundary after its time */
    hard?: boolean;
    /** For an `interval` band: how far apart, in milliseconds */
    everyMs?: number;
    /** Where this sits in the operator's own order, which is what settles a boundary two rules both want */
    position: number;
    /** A rule turned off without being lost */
    enabled: boolean;
    /** What this band is about, as a subject of its own kind: a news category, later a weather location. Absent means it covers whatever it finds */
    topicId?: string;
}

/**
 * What a band in a file is about, carried whole so the file works on a station that has never heard of it
 * generated from [ClockPackTopic](../../../../../apps/api/data/contracts/director/clock.types.ck)
 */
export interface ClockPackTopic {
    /** What identifies it within the band's kind */
    key: string;
    /** What a break calls it out loud */
    label: string;
    /** This sort of break's own settings for this subject */
    config?: Record<string, unknown>;
}

/**
 * A format clock as one file, to hand to another station. Each entry is read as a `ClockPackRow` when it
 * is imported, so one a station cannot use is reported rather than refusing the file
 * generated from [ClockPack](../../../../../apps/api/data/contracts/director/clock.types.ck)
 */
export interface ClockPack {
    /** Says the file is a clock file */
    format: 'deadair.clock';
    /** The version of the document's shape. This station reads version 1 */
    version: number;
    /** What the file is, as whoever made it would describe it */
    name: string;
    bands: Record<string, unknown>[];
}

/**
 * generated from [ClockBandList](../../../../../apps/api/data/contracts/director/clock.types.ck)
 */
export interface ClockBandList {
    bands: ClockBand[];
    /** Which sorts of break this station can actually make right now: one it can write and speak, one it has recordings of, or one it produces as an episode. A band naming anything else claims its boundary and then passes over it */
    producibleKinds: string[];
}

export interface ClockBandListInput {
    bands: ClockBandInput[];
    /** Which sorts of break this station can actually make right now: one it can write and speak, one it has recordings of, or one it produces as an episode. A band naming anything else claims its boundary and then passes over it */
    producibleKinds: string[];
}

/**
 * One rule in a file. Nothing about the station it came from: no id, no place in its order, and no switch
 * generated from [ClockPackRow](../../../../../apps/api/data/contracts/director/clock.types.ck)
 */
export interface ClockPackRow {
    /** Which sort of break it wants, as `segments.kind` spells it */
    kind: string;
    at: 'clock' | 'interval';
    hour?: number;
    minute?: number;
    days?: number[];
    hard?: boolean;
    everyMs?: number;
    topic?: ClockPackTopic;
}

/**
 * What an import did, and the clock as it now stands
 * generated from [ClockImportResult](../../../../../apps/api/data/contracts/director/clock.types.ck)
 */
export interface ClockImportResult {
    plan: PackImportPlan;
    list: ClockBandList;
}

export interface ClockImportResultInput {}
