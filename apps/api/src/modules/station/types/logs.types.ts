import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Five values, where `PluginLogLevel` next door has four. The plugin enum is the narrower one on
 * purpose — that is the vocabulary a plugin's own `PluginLogger` offers — while `api.log` is written
 * by `DeadairLogger`, which tees every level the app-wide `Logger` has, `trace` included. Narrowing
 * here would make a `trace` line unrepresentable in the type of the surface that reads the file it
 * is in.
 * generated from [LogLevel](../../../../data/contracts/station/logs.types.ck#L12)
 */
export const LogLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

/**
 * One log file this install has, whether or not anything has been written to it
 * generated from [LogSource](../../../../data/contracts/station/logs.types.ck#L14)
 */
export const LogSource = z.strictObject({
    id: z.string().min(1).max(40).describe('A closed set the API owns: `api`, `liquidsoap`, `shim`. Never a path'),
    label: z.string().min(1).max(80),
    description: z.string().max(300).describe('What writes it, in a sentence, because "shim" means nothing to somebody who has not read the tree'),
    present: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the file is there at all. A station that never ran the stream has no stream logs, which is a state rather than a fault'),
    levels: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether its lines carry a level, so the console knows whether to offer the filter'),
    bytes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Retained size across every segment. Zero when absent'),
    lastWriteAt: _ZodDatetime.optional().describe('Absent when nothing has ever been written'),
});
export type LogSource = z.infer<typeof LogSource>;

/**
 * One line, as far as it could be read back
 * generated from [LogLine](../../../../data/contracts/station/logs.types.ck#L28)
 */
export const LogLine = z.strictObject({
    ts: z.string().max(40).optional().describe('Absent on a line this API did not write, and on one of its own that did not parse'),
    level: LogLevel.optional().describe('Absent for the same two reasons'),
    text: z.string().max(65536).describe('Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together'),
});
export type LogLine = z.infer<typeof LogLine>;

/**
 * generated from [LogQuery](../../../../data/contracts/station/logs.types.ck#L41)
 */
export const LogQuery = z.strictObject({
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(2000)).optional(),
    level: LogLevel.optional().describe('Ignored by a source whose lines carry no level'),
});
export type LogQuery = z.infer<typeof LogQuery>;

/**
 * generated from [LogSourceList](../../../../data/contracts/station/logs.types.ck#L24)
 */
export const LogSourceList = z.strictObject({
    sources: z.array(LogSource).describe('Every source, in a fixed order, including the ones that are not present'),
});
export type LogSourceList = z.infer<typeof LogSourceList>;

/**
 * generated from [LogPage](../../../../data/contracts/station/logs.types.ck#L34)
 */
export const LogPage = z.strictObject({
    sourceId: z.string().min(1).max(40),
    level: LogLevel.optional().describe(
        'The minimum severity that was applied. Absent when the source carries no levels, so a filter that did nothing cannot look as though it worked',
    ),
    truncated: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe("Whether the read hit its byte budget, so the oldest line here is not the file's first"),
    lines: z.array(LogLine).describe('Newest first, as the plugin log page, the activity feed and the script history all send'),
});
export type LogPage = z.infer<typeof LogPage>;
