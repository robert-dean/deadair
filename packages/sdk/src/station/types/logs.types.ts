/**
 * Five values, where `PluginLogLevel` next door has four. The plugin enum is the narrower one on
 * purpose — that is the vocabulary a plugin's own `PluginLogger` offers — while `api.log` is written
 * by `DeadairLogger`, which tees every level the app-wide `Logger` has, `trace` included. Narrowing
 * here would make a `trace` line unrepresentable in the type of the surface that reads the file it
 * is in.
 * generated from [LogLevel](file://./../../../../../apps/api/data/contracts/station/logs.types.ck#L12)
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * One log file this install has, whether or not anything has been written to it
 * generated from [LogSource](file://./../../../../../apps/api/data/contracts/station/logs.types.ck#L14)
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
    lastWriteAt?: string;
}

/**
 * One line, as far as it could be read back
 * generated from [LogLine](file://./../../../../../apps/api/data/contracts/station/logs.types.ck#L28)
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
 * generated from [LogQuery](file://./../../../../../apps/api/data/contracts/station/logs.types.ck#L41)
 */
export interface LogQuery {
    limit?: number;
    /** Ignored by a source whose lines carry no level */
    level?: LogLevel;
}

/**
 * generated from [LogSourceList](file://./../../../../../apps/api/data/contracts/station/logs.types.ck#L24)
 */
export interface LogSourceList {
    /** Every source, in a fixed order, including the ones that are not present */
    sources: LogSource[];
}

/**
 * generated from [LogPage](file://./../../../../../apps/api/data/contracts/station/logs.types.ck#L34)
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
