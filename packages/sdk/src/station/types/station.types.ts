import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * One concrete thing an attention row is about, so the reason does not live a page away.
 *
 * The row above it counts and categorises; this names. "4 records have no copy left that will play"
 * is a category an operator can do nothing with until they know WHICH four and WHY each one, and
 * every one of those facts was already stored — the fetch error on `track_audio.last_error`, the
 * provider's refusal on `track_sources.playable` — and reachable only by finding the record and
 * hovering a cell on its page. This is that fact travelling with the row that counted it.
 * generated from [AttentionEvidence](../../../../../apps/api/data/contracts/station/station.types.ck#L14)
 */
export interface AttentionEvidence {
    /** The thing itself, as an operator would name it: a record's title and who made it */
    label: string;
    /** Why THIS one, in the station's own sentence. The row's `detail` says what the category means; this says what happened here */
    reason: string;
    /** The page holding the whole of it. Absent where there is no page for it, which the running order can hold: a record the catalog never ingested has none */
    route?: string;
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
 * generated from [StationHeartbeat](../../../../../apps/api/data/contracts/station/station.types.ck#L45)
 */
export interface StationHeartbeat {
    name: string;
    /** When the loop registered, which is when it was last (re)started */
    startedAt: DateTime;
    /** When it last completed a pass. Absent until it completes its first */
    lastBeat?: DateTime;
}

export interface StationHeartbeatInput {}

/** Rehydrates every wire-encoded scalar in a StationHeartbeat into its runtime type. Mutates and returns `raw`. */
export function reviveStationHeartbeat(raw: StationHeartbeat): StationHeartbeat {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['startedAt'] = __dt(__o0['startedAt'], 'StationHeartbeat.startedAt');
    if (__o0['lastBeat'] != null) {
        __o0['lastBeat'] = __dt(__o0['lastBeat'], 'StationHeartbeat.lastBeat');
    }
    return raw;
}

/**
 * How much of the library the station has actually looked at.
 *
 * The counts `/catalog/tracks` already answers with, lifted out of a page of rows: a check-up wants
 * the sentence "13 of 581 measured" without asking for thirteen tracks to get it.
 * generated from [StationBacklog](../../../../../apps/api/data/contracts/station/station.types.ck#L55)
 */
export interface StationBacklog {
    total: number;
    cached: number;
    measured: number;
}

export interface StationBacklogInput {}

/**
 * One thing that wants the operator's attention, or the fact that nothing does
 * generated from [AttentionItem](../../../../../apps/api/data/contracts/station/station.types.ck#L21)
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
    /** A HANDFUL of the things this row is about, never all of them: this answer is polled and a row about four hundred records must not be four hundred sentences. `count` stays the true figure, and a console showing fewer than it says so */
    evidence?: AttentionEvidence[];
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
 * generated from [StationCheckup](../../../../../apps/api/data/contracts/station/station.types.ck#L80)
 */
export interface StationCheckup {
    /** When this reading was taken, so a stale page cannot pass itself off as now */
    readAt: DateTime;
    /** The commit this station was built from, as the image's `org.opencontainers.image.revision` label says it. Unlike the sections below, absent is not a failed reader: it means nothing stamped this build, which is what a development tree and a hand-built image both are */
    revision?: string;
    /** The release this station is, as the image's `org.opencontainers.image.version` label says it. Absent on the same terms as `revision` and for a second reason: only a tagged build carries one, so a station following `latest` reports a commit and no version */
    version?: string;
    heartbeats?: StationHeartbeat[];
    backlog?: StationBacklog;
}

export interface StationCheckupInput {}

/** Rehydrates every wire-encoded scalar in a StationCheckup into its runtime type. Mutates and returns `raw`. */
export function reviveStationCheckup(raw: StationCheckup): StationCheckup {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['readAt'] = __dt(__o0['readAt'], 'StationCheckup.readAt');
    if (__o0['heartbeats'] != null) {
        {
            const __a1 = __o0['heartbeats'] as unknown[];
            for (let __i2 = 0; __i2 < __a1.length; __i2++) {
                reviveStationHeartbeat(__a1[__i2] as never);
            }
        }
    }
    return raw;
}

/**
 * Everything wrong or waiting, worst first
 * generated from [StationAttention](../../../../../apps/api/data/contracts/station/station.types.ck#L32)
 */
export interface StationAttention {
    items: AttentionItem[];
}
