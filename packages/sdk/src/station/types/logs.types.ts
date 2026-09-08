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
 * Five values, where `PluginLogLevel` next door has four. The plugin enum is the narrower one on
 * purpose — that is the vocabulary a plugin's own `PluginLogger` offers — while `api.log` is written
 * by `DeadairLogger`, which tees every level the app-wide `Logger` has, `trace` included. Narrowing
 * here would make a `trace` line unrepresentable in the type of the surface that reads the file it
 * is in.
 * generated from [LogLevel](../../../../../apps/api/data/contracts/station/logs.types.ck#L12)
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * One log file this install has, whether or not anything has been written to it
 * generated from [LogSource](../../../../../apps/api/data/contracts/station/logs.types.ck#L14)
 */
export interface LogSource {
    /** A closed set the API owns: `api`, `liquidsoap`, `shim`. Never a path */
    id: string;
    label: string;
    /** What writes it, in a sentence, because "shim" means nothing to somebody who has not read the tree */
    description: string;
    /** Whether the file is there at all. A station that never ran the stream has no stream logs, which is a state rather than a fault */
    present: boolean;
    /** Whether its lines carry a level, so the console knows whether to offer the filter */
    levels: boolean;
    /** Retained size across every segment. Zero when absent */
    bytes: number;
    /** Absent when nothing has ever been written */
    lastWriteAt?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a LogSource into its runtime type. Mutates and returns `raw`. */
export function reviveLogSource(raw: LogSource): LogSource {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['lastWriteAt'] != null) {
        __o0['lastWriteAt'] = __dt(__o0['lastWriteAt'], 'LogSource.lastWriteAt');
    }
    return raw;
}

/**
 * One line, as far as it could be read back
 * generated from [LogLine](../../../../../apps/api/data/contracts/station/logs.types.ck#L28)
 */
export interface LogLine {
    /** Absent on a line this API did not write, and on one of its own that did not parse */
    ts?: string;
    /** Absent for the same two reasons */
    level?: LogLevel;
    /** Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together */
    text: string;
}

/**
 * generated from [LogQuery](../../../../../apps/api/data/contracts/station/logs.types.ck#L41)
 */
export interface LogQuery {
    limit?: number;
    /** Ignored by a source whose lines carry no level */
    level?: LogLevel;
}

/**
 * generated from [LogSourceList](../../../../../apps/api/data/contracts/station/logs.types.ck#L24)
 */
export interface LogSourceList {
    /** Every source, in a fixed order, including the ones that are not present */
    sources: LogSource[];
}

/** Rehydrates every wire-encoded scalar in a LogSourceList into its runtime type. Mutates and returns `raw`. */
export function reviveLogSourceList(raw: LogSourceList): LogSourceList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['sources'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveLogSource(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * generated from [LogPage](../../../../../apps/api/data/contracts/station/logs.types.ck#L34)
 */
export interface LogPage {
    sourceId: string;
    /** The minimum severity that was applied. Absent when the source carries no levels, so a filter that did nothing cannot look as though it worked */
    level?: LogLevel;
    /** Whether the read hit its byte budget, so the oldest line here is not the file's first */
    truncated: boolean;
    /** Newest first, as the plugin log page, the activity feed and the script history all send */
    lines: LogLine[];
}
