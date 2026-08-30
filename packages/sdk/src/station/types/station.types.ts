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
 * One loop the station runs, and when it last came round.
 *
 * Two timestamps and no verdict, because the loop cannot supply one: a five-second reconcile and a
 * nightly sweep are both healthy and no single threshold describes both. `Heartbeat` itself takes
 * this position — it answers how long it has been and lets the reader decide — and a `stalled`
 * boolean here would be this module inventing the threshold that file deliberately refuses to.
 *
 * `lastBeat` is absent until a loop finishes its first pass, which is why `startedAt` is there: from
 * the two of them a reader can tell a loop that has never completed anything from one that stopped.
 * generated from [StationHeartbeat](file://./../../../../../apps/api/data/contracts/station/station.types.ck#L31)
 */
export interface StationHeartbeat {
    name: string;
    /** When the loop registered, which is when it was last (re)started */
    startedAt: string;
    /** When it last completed a pass. Absent until it completes its first */
    lastBeat?: string;
}

export interface StationHeartbeatInput {}

/**
 * How much of the library the station has actually looked at.
 *
 * The counts `/catalog/tracks` already answers with, lifted out of a page of rows: a check-up wants
 * the sentence "13 of 581 measured" without asking for thirteen tracks to get it.
 * generated from [StationBacklog](file://./../../../../../apps/api/data/contracts/station/station.types.ck#L41)
 */
export interface StationBacklog {
    total: number;
    cached: number;
    measured: number;
}

export interface StationBacklogInput {}

/**
 * Everything wrong or waiting, worst first
 * generated from [StationAttention](file://./../../../../../apps/api/data/contracts/station/station.types.ck#L18)
 */
export interface StationAttention {
    items: AttentionItem[];
}

/**
 * One reading of the machinery, for a page that assembles the station's health.
 *
 * It carries ONLY the two signals nothing else exposes. Everything else a check-up shows — the
 * silence verdict, the listener count, what needs somebody, the plugin statuses, the disk — is
 * already on a contract the console reads, and composing them again here would be a second answer
 * that can disagree with the first. `/playout/status` in particular is polled every two seconds for
 * the transport strip, so asking for it a second way would be a second reading of the same fact.
 *
 * Each section is OPTIONAL and absent means that reader failed. A page saying what is wrong is the
 * worst place for one broken reader to take the whole answer down, which is the rule
 * `StationAttentionService` already works to. `revision` is the one exception and says so on its
 * own line: it cannot fail, so absent there means something else.
 *
 * The revision is on THIS contract rather than composed from `/health`, which also reports it, and
 * that is not the second-answer problem the paragraph above describes. Both read one string from one
 * place at boot, so they cannot disagree. What they differ in is who can reach them: `/health` is
 * `operation(internal)`, deliberately, so it generates no SDK method and the console cannot call it
 * — which would leave "which build is this" answerable only from a shell, the one thing carrying it
 * here exists to fix.
 * generated from [StationCheckup](file://./../../../../../apps/api/data/contracts/station/station.types.ck#L66)
 */
export interface StationCheckup {
    /** When this reading was taken, so a stale page cannot pass itself off as now */
    readAt: string;
    /** The commit this station was built from, as the image's `org.opencontainers.image.revision` label says it. Unlike the sections below, absent is not a failed reader: it means nothing stamped this build, which is what a development tree and a hand-built image both are */
    revision?: string;
    heartbeats?: StationHeartbeat[];
    backlog?: StationBacklog;
}

export interface StationCheckupInput {}
