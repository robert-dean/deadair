/**
 * One thing that wants the operator's attention, or the fact that nothing does
 * generated from [AttentionItem](file://./../../../../../apps/api/data/contracts/station/station.types.ck#L8)
 */
export interface AttentionItem {
    /** What this is, as a stable key: `silence`, `benchedCopies`, `noPersona`. The console groups and counts on it rather than on the sentence */
    code: string;
    /** `failure` is the station not doing its job, `warning` is something failing beside a station that is working, and `notice` is a thing nobody has set up yet. A notice is not a fault and must not be drawn as one */
    severity: 'failure' | 'warning' | 'notice';
    /** The line an operator reads first */
    title: string;
    /** The whole of it, in a sentence. Where the station already has words for a fact, these are those words rather than a second phrasing of them */
    detail: string;
    /** The console page that can do something about it */
    route: string;
    /** How many things this is about, where that is a number rather than a state */
    count?: number;
}

/**
 * Everything wrong or waiting, worst first
 * generated from [StationAttention](file://./../../../../../apps/api/data/contracts/station/station.types.ck#L18)
 */
export interface StationAttention {
    items: AttentionItem[];
}
