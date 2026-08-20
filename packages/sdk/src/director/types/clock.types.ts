/**
 * One rule on the station's format clock: a sort of break, and when it happens
 * generated from [ClockBand](file://./../../../../../apps/api/data/contracts/director/clock.types.ck#L8)
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
 * generated from [ClockBandList](file://./../../../../../apps/api/data/contracts/director/clock.types.ck#L21)
 */
export interface ClockBandList {
    bands: ClockBand[];
}

export interface ClockBandListInput {
    bands: ClockBandInput[];
}
