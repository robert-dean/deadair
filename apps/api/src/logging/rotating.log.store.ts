import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createStream, type RotatingFileStream } from 'rotating-file-stream';

/**
 * Hard ceiling on {@link RotatingLogStoreOptions.maxLineBytes}.
 *
 * `apps/api`'s plugin-logs HTTP contract validates each returned entry's
 * `text` against `string(max=65536)` (see the `PluginLogEntry` contract).
 * If an operator's env var pushed `LOG_MAX_LINE_BYTES` past that, a long log
 * line would pass this store's own truncation and then fail contract
 * validation on the way out, turning a too-long line into a 500 on the logs
 * endpoint. This constant and that contract's `max` are the same number and
 * must be changed together.
 */
export const MAX_LINE_BYTES_CEILING = 64 * 1024;

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;
const DEFAULT_MAX_VALUE_CHARS = 512;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024;
const DEFAULT_TAIL_LIMIT = 200;

/** Filename written for the host's own log (channel `undefined`). */
const API_LOG_FILENAME = 'api.log';
/** Filename written under a plugin's channel directory. */
const PLUGIN_LOG_FILENAME = 'plugin.log';

/** Cap on a sanitized channel directory name, before the hash suffix. */
const MAX_CHANNEL_LENGTH = 80;
/** Length, in hex characters, of the collision-breaking hash suffix. */
const HASH_SUFFIX_LENGTH = 8;
/** Characters a channel directory name may contain unescaped. */
const CHANNEL_DISALLOWED_PATTERN = /[^A-Za-z0-9._-]/g;

/** Minimum-severity ordering used by the `level` filter on {@link RotatingLogStore.tail}. */
const LEVEL_ORDER: Record<string, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
};

/** Meta keys whose value is replaced with `***` before a line is written. */
const REDACT_KEY_PATTERN = /token|secret|password|authorization|api[_-]?key|credential/i;

/**
 * Meta keys that match {@link REDACT_KEY_PATTERN} on the word "token" but hold a COUNT.
 *
 * The pattern matches on a substring, which is right for `access_token` and `refreshToken` and
 * wrong for `tokens` — a number of tokens a model produced is a measurement, not a credential, and
 * redacting it destroys the one figure that says what a model call actually did.
 *
 * It was live on every model path the station has: set generation, break writing and fact
 * extraction all logged `tokens=***`, and it was the ONLY redacted field in the whole log. It cost
 * a real diagnosis — a refill reported as having exhausted a 12,000-token ceiling had to be shown
 * to have used about 290 of them by measuring the host's token rate out of `script_history` and
 * dividing, because the number itself had been scrubbed on the way to disk.
 *
 * An ALLOWLIST of exact keys rather than a cleverer pattern, and that direction is the whole point:
 * a narrower regex risks letting a real credential through for the sake of a log line, where a
 * missing entry here costs nothing worse than a `***` somebody comes back and adds a word to. Held
 * lower-case and compared lower-case, so `outputTokens` and `output_tokens` are one entry.
 *
 * Every name here is one the tree actually logs or that the AI SDK's usage object carries. Do not
 * add a key speculatively: an entry for a name nobody writes is a hole waiting for somebody to
 * write a secret under it.
 */
const COUNT_KEYS = new Set(['tokens', 'totaltokens', 'outputtokens', 'inputtokens', 'reasoningtokens', 'maxtokens', 'maxoutputtokens']);

/** Whether a meta key's value is a credential rather than a count, and so must not be written. */
const isRedacted = (key: string): boolean => !COUNT_KEYS.has(key.toLowerCase()) && REDACT_KEY_PATTERN.test(key);
/** Matches a bearer token embedded inside an otherwise-innocuous string value. */
const BEARER_TOKEN_PATTERN = /Bearer\s+\S+/gi;

/** Splits a written line back into its timestamp, level and free-text parts. */
const LINE_PATTERN = /^(\S+)\s+(\S+)\s+([\s\S]*)$/;

/**
 * The level tag on a log entry.
 *
 * Kept as a plain union here for documentation purposes only: {@link
 * RotatingLogStore.append} accepts a plain `string`, because the app-wide
 * `Logger` interface from `@maroonedsoftware/logger` (piped in by
 * `FileTeeLogger`, package 02) has all five of these, while the
 * plugin-facing contract enum is the narrower `debug|info|warn|error`. That
 * narrowing is `PluginLog`'s job (package 06), not this store's.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** One log line, read back from disk. */
export interface LogEntry {
    /** ISO 8601 timestamp with milliseconds, or `''` if the line did not parse. */
    ts: string;
    /** Upper-cased level token as written, or `''` if the line did not parse. */
    level: string;
    /**
     * Everything after the level token: the message and, if present, its
     * `| key=value ...` meta tail. Deliberately not re-split — a fragile
     * re-parse of something we already rendered buys nothing, the viewer just
     * displays it and filters on `level`.
     */
    text: string;
}

/** Constructor options for {@link RotatingLogStore}. */
export interface RotatingLogStoreOptions {
    /** Directory holding the API's own log file and one subdirectory per plugin channel. */
    root: string;
    /** Rotate a channel's active file once it reaches this many bytes. Default 2 MiB. */
    maxBytes?: number;
    /** Retained rotated segments per channel, on top of the active file. Default 3. */
    maxFiles?: number;
    /** Cap, in characters, on a single rendered meta value. Default 512. */
    maxValueChars?: number;
    /**
     * Cap, in bytes, on a whole formatted line. Default 8 KiB, hard-clamped at
     * construction to {@link MAX_LINE_BYTES_CEILING}.
     */
    maxLineBytes?: number;
}

/**
 * Appends, tails and downloads rotated, redacted log files for the API's own
 * log and for each plugin's channel.
 *
 * Deliberately DI-free: the app logger is built in `setup.server.ts` before
 * any container exists, so the thing both `setup.server.ts` and
 * `plugins.module.ts` construct against has to be a plain class with no
 * `injectkit` dependency and no `AppConfig` lookups of its own. See
 * `log.store.ts` for how the two call sites end up sharing one instance.
 *
 * Rotation, retention, write ordering and backpressure are all
 * `rotating-file-stream`'s job; this class only formats, redacts and reads
 * lines back. `append` is fire-and-forget and can never throw: a log sink
 * that can take the server down is worse than no log sink.
 */
export class RotatingLogStore {
    private readonly root: string;
    private readonly maxBytes: number;
    private readonly maxFiles: number;
    private readonly maxValueChars: number;
    private readonly maxLineBytes: number;

    /** Open streams, keyed by sanitized channel (`''` for the API's own log). */
    private readonly streams = new Map<string, RotatingFileStream>();
    /** Channels that have already logged a stream `'error'` warning, so it only happens once. */
    private readonly warnedChannels = new Set<string>();
    private closed = false;

    constructor(options: RotatingLogStoreOptions) {
        this.root = options.root;
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
        this.maxValueChars = options.maxValueChars ?? DEFAULT_MAX_VALUE_CHARS;

        const requestedMaxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
        if (requestedMaxLineBytes > MAX_LINE_BYTES_CEILING) {
            console.warn(
                `[RotatingLogStore] maxLineBytes (${requestedMaxLineBytes}) exceeds the ` +
                    `${MAX_LINE_BYTES_CEILING}-byte ceiling; clamping. Raise MAX_LINE_BYTES_CEILING ` +
                    `and the PluginLogEntry.text contract max together if this is intentional.`,
            );
            this.maxLineBytes = MAX_LINE_BYTES_CEILING;
        } else {
            this.maxLineBytes = requestedMaxLineBytes;
        }
    }

    /**
     * Formats and appends one log entry to `channel`'s active file.
     *
     * Fire-and-forget and never throws, for any input, including an
     * unwritable root or a channel that tries to escape `root` with `../`:
     * the whole body is wrapped so nothing here can become an uncaught
     * exception or a rejected promise the caller has to handle.
     *
     * A closed store still accepts the entry, but not through a stream:
     * `close()` has already drained and ended every open stream, and going
     * through {@link getOrCreateStream} here would either throw on a
     * destroyed handle or silently reopen a stream that nothing will ever
     * flush or close again. Instead the line is written with a synchronous
     * filesystem append via {@link appendSyncAfterClose} — see that method
     * for why this is safe only for the shutdown tail, not general traffic.
     */
    append(channel: string | undefined, level: string, message: string, meta?: Record<string, unknown>): void {
        try {
            const line = formatLine(level, message, meta, this.maxValueChars, this.maxLineBytes);

            if (this.closed) {
                this.appendSyncAfterClose(channel, line);
                return;
            }

            const stream = this.getOrCreateStream(channel);
            if (stream === undefined) return;
            stream.write(`${line}\n`);
        } catch (error) {
            console.warn('[RotatingLogStore] failed to append log entry', error);
        }
    }

    /**
     * Reads back the newest entries for `channel`, newest-last.
     *
     * Walks segments newest-first (by mtime, see {@link listSegmentsByMtime})
     * and stops as soon as `limit` entries have been collected, so a small
     * tail on a channel with several rotated segments does not read all of
     * them. `level` is a minimum-severity filter, not an exact match.
     */
    async tail(channel: string | undefined, options?: { limit?: number; level?: string }): Promise<LogEntry[]> {
        try {
            const limit = options?.limit ?? DEFAULT_TAIL_LIMIT;
            const minSeverity = options?.level !== undefined ? LEVEL_ORDER[options.level.toLowerCase()] : undefined;

            const dir = this.channelDir(channel);
            const segments = await listSegmentsByMtime(dir);
            segments.reverse(); // newest first

            const collectedNewestFirst: LogEntry[] = [];
            for (const segment of segments) {
                if (collectedNewestFirst.length >= limit) break;

                let raw: string;
                try {
                    raw = await readFile(segment, 'utf8');
                } catch {
                    continue;
                }

                const lines = raw.split('\n').filter(line => line.length > 0);
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (collectedNewestFirst.length >= limit) break;

                    const rawLine = lines[i];
                    if (rawLine === undefined) continue;

                    const entry = parseLine(rawLine);
                    if (minSeverity !== undefined) {
                        const severity = LEVEL_ORDER[entry.level.toLowerCase()];
                        if (severity === undefined || severity < minSeverity) continue;
                    }
                    collectedNewestFirst.push(entry);
                }
            }

            return collectedNewestFirst.reverse();
        } catch (error) {
            console.warn('[RotatingLogStore] failed to tail log', error);
            return [];
        }
    }

    /**
     * Returns every retained segment for `channel`, concatenated oldest-first,
     * for download.
     *
     * Bounded by construction: at most `maxFiles + 1` segments of at most
     * `maxBytes` each (about 8 MiB at the defaults).
     */
    async readAll(channel: string | undefined): Promise<string> {
        try {
            const dir = this.channelDir(channel);
            const segments = await listSegmentsByMtime(dir); // oldest first

            const parts: string[] = [];
            for (const segment of segments) {
                try {
                    parts.push(await readFile(segment, 'utf8'));
                } catch {
                    // A segment that vanished or rotated mid-read is skipped, not fatal.
                }
            }
            return parts.join('');
        } catch (error) {
            console.warn('[RotatingLogStore] failed to read log', error);
            return '';
        }
    }

    /**
     * Removes `channel`'s files and drops its open stream, if any.
     *
     * For the API's own channel (`undefined`), `root` doubles as the
     * directory for other plugins' subdirectories, so only files directly in
     * `root` are removed. For a plugin channel, the whole sanitized
     * subdirectory belongs to that channel alone and is removed outright.
     */
    async clear(channel: string | undefined): Promise<void> {
        try {
            const key = this.channelKey(channel);
            const stream = this.streams.get(key);
            if (stream !== undefined) {
                this.streams.delete(key);
                stream.end();
            }

            const dir = this.channelDir(channel);
            if (channel === undefined) {
                const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
                await Promise.all(entries.filter(entry => entry.isFile()).map(entry => rm(join(dir, entry.name), { force: true })));
            } else {
                await rm(dir, { recursive: true, force: true });
            }
        } catch (error) {
            console.warn('[RotatingLogStore] failed to clear log', error);
        }
    }

    /**
     * Drains every open stream at shutdown. Safe to call twice: the second
     * call is a no-op because the first already cleared {@link streams}.
     */
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;

        const streams = Array.from(this.streams.values());
        this.streams.clear();

        await Promise.all(
            streams.map(
                stream =>
                    new Promise<void>(resolvePromise => {
                        stream.once('close', () => resolvePromise());
                        stream.once('error', () => resolvePromise());
                        stream.end();
                    }),
            ),
        );
    }

    /**
     * Writes one already-formatted line straight to `channel`'s file with a
     * synchronous filesystem append, bypassing streams entirely.
     *
     * Only reached from {@link append} once {@link close} has ended every
     * stream. Module shutdown order flushes every other module's logging
     * before `LoggingModule` closes this store, but the ServerKit builder's
     * own final `'Server closed'` line is appended through this same
     * instance afterwards, and would otherwise be lost. This path writes
     * with `appendFileSync` instead of going through
     * {@link getOrCreateStream}, and never touches {@link streams}: a closed
     * store must never hand out or create a `RotatingFileStream` again.
     * Rotation, size checks and pruning are not run here — a handful of
     * shutdown-tail lines cannot meaningfully overshoot the size bound, and
     * consulting rotation post-close is exactly the stream resurrection this
     * method exists to avoid.
     *
     * `mkdirSync` is defensive: in the ordinary shutdown case the channel's
     * directory already exists from prior stream writes, but nothing
     * guarantees a channel logged anything before close.
     *
     * A write failure here is a genuine fault, not routine backpressure, so
     * it warns once per channel via {@link warnedChannels} — reusing the
     * same gate {@link getOrCreateStream}'s stream-error handler uses — and
     * is otherwise swallowed, matching {@link append}'s never-throw
     * contract.
     */
    private appendSyncAfterClose(channel: string | undefined, line: string): void {
        const key = this.channelKey(channel);
        try {
            const dir = this.channelDir(channel);
            const filename = channel === undefined ? API_LOG_FILENAME : PLUGIN_LOG_FILENAME;
            mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, filename), `${line}\n`);
        } catch (error) {
            if (!this.warnedChannels.has(key)) {
                this.warnedChannels.add(key);
                console.warn(`[RotatingLogStore] failed to write post-close log entry on channel "${key}"`, error);
            }
        }
    }

    /**
     * Returns the open stream for `channel`, creating and directory-scoping
     * it on first use.
     *
     * Every stream gets an `'error'` listener at creation: an unhandled
     * `'error'` on a Writable is an uncaught exception, which would let
     * something like a full disk take the whole server down. The handler
     * warns once per channel and drops the stream from {@link streams} so a
     * later `append` retries instead of writing into a dead stream.
     *
     * Returns `undefined` once the store is closed, rather than consulting
     * the (already-cleared) {@link streams} cache and creating a fresh
     * stream that nothing will ever end. `append` already checks `closed`
     * itself and never reaches this method post-close, but the guard lives
     * here too as defense in depth against any other caller.
     */
    private getOrCreateStream(channel: string | undefined): RotatingFileStream | undefined {
        if (this.closed) return undefined;

        const key = this.channelKey(channel);
        const existing = this.streams.get(key);
        if (existing !== undefined) return existing;

        const dir = this.channelDir(channel);
        const filename = channel === undefined ? API_LOG_FILENAME : PLUGIN_LOG_FILENAME;

        const stream = createStream(filename, {
            size: `${this.maxBytes}B`,
            maxFiles: this.maxFiles,
            path: dir,
        });

        stream.on('error', error => {
            if (!this.warnedChannels.has(key)) {
                this.warnedChannels.add(key);
                console.warn(`[RotatingLogStore] write error on channel "${key}"`, error);
            }
            this.streams.delete(key);
        });

        this.streams.set(key, stream);
        return stream;
    }

    /** The map key for `channel`: `''` for the API's own log, else its sanitized id. */
    private channelKey(channel: string | undefined): string {
        return channel === undefined ? '' : safeChannel(channel);
    }

    /**
     * Resolves `channel`'s directory under `root`, asserting the resolved
     * path is still under `root`. Sanitization in {@link safeChannel} should
     * already guarantee this; the assertion is defense in depth against a
     * bug in that sanitization letting a crafted plugin id escape `root`.
     */
    private channelDir(channel: string | undefined): string {
        const rootResolved = resolve(this.root);
        if (channel === undefined) return rootResolved;

        const dir = resolve(rootResolved, safeChannel(channel));
        if (dir !== rootResolved && !dir.startsWith(rootResolved + sep)) {
            throw new Error(`resolved log channel path escaped root: ${dir}`);
        }
        return dir;
    }
}

/**
 * Sanitizes a channel id (a plugin id from a third-party manifest, or
 * `undefined` for the API's own log) into a safe directory name.
 *
 * This is a security boundary, not cosmetics. Only `[A-Za-z0-9._-]` passes
 * through unchanged; everything else maps to `_`. A result that is exactly
 * `.` or `..`, or empty, is replaced outright, since either would resolve to
 * a directory other than the one meant. Whenever sanitization changed the
 * input — including the length cap — a short hash of the *raw* id is
 * appended, so two different ids that sanitize to the same string cannot
 * collide onto one directory.
 */
export function safeChannel(id: string): string {
    let sanitized = id.replace(CHANNEL_DISALLOWED_PATTERN, '_');

    if (sanitized === '' || /^\.{1,2}$/.test(sanitized)) {
        sanitized = '_';
    }

    let changed = sanitized !== id;

    if (sanitized.length > MAX_CHANNEL_LENGTH) {
        sanitized = sanitized.slice(0, MAX_CHANNEL_LENGTH);
        changed = true;
    }

    if (!changed) return sanitized;

    const hash = createHash('sha256').update(id).digest('hex').slice(0, HASH_SUFFIX_LENGTH);
    return `${sanitized}-${hash}`;
}

/**
 * Lists a channel directory's files, oldest-first by mtime.
 *
 * Segments are discovered by listing the directory and sorting by mtime, not
 * by assuming a filename pattern: the read side must not encode
 * `rotating-file-stream`'s naming, which is free to change. A missing
 * directory (a channel that has never logged) yields an empty list rather
 * than throwing.
 */
async function listSegmentsByMtime(dir: string): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    const files = entries.filter(entry => entry.isFile()).map(entry => join(dir, entry.name));

    const stamped = await Promise.all(
        files.map(async path => {
            try {
                const stats = await stat(path);
                return { path, mtimeMs: stats.mtimeMs };
            } catch {
                return undefined;
            }
        }),
    );

    return stamped
        .filter((entry): entry is { path: string; mtimeMs: number } => entry !== undefined)
        .sort((a, b) => a.mtimeMs - b.mtimeMs)
        .map(entry => entry.path);
}

/**
 * Renders one log entry as a single line: `<ISO ts> <LEVEL> <message>` and,
 * if there is meta, ` | key=value ...`. `\r` and `\n` are escaped to the two
 * characters `\` `n` in both the message and meta values, so the
 * one-entry-per-line invariant holds even for a multi-line stack trace.
 */
function formatLine(level: string, message: string, meta: Record<string, unknown> | undefined, maxValueChars: number, maxLineBytes: number): string {
    const ts = new Date().toISOString();
    const levelToken = level.toUpperCase().padEnd(5, ' ');
    let line = `${ts} ${levelToken} ${escapeNewlines(message)}`;

    if (meta !== undefined) {
        const rendered = renderMeta(meta, maxValueChars);
        if (rendered.length > 0) line += ` | ${rendered}`;
    }

    return truncateLineBytes(line, maxLineBytes);
}

/** Renders meta as `key=value` pairs separated by a single space, redacted and truncated. */
function renderMeta(meta: Record<string, unknown>, maxValueChars: number): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(meta)) {
        const rendered = isRedacted(key) ? '***' : renderMetaValue(value, maxValueChars);
        parts.push(`${key}=${rendered}`);
    }

    return parts.join(' ');
}

/** Stringifies, redacts embedded bearer tokens in, escapes and truncates one meta value. */
function renderMetaValue(value: unknown, maxValueChars: number): string {
    let rendered = stringifyMetaValue(value);
    rendered = rendered.replace(BEARER_TOKEN_PATTERN, 'Bearer ***');
    rendered = escapeNewlines(rendered);
    return truncateChars(rendered, maxValueChars);
}

function stringifyMetaValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** Replaces `\r`/`\n` (and `\r\n`) with the two literal characters `\` `n`. */
function escapeNewlines(value: string): string {
    return value.replace(/\r\n|\r|\n/g, '\\n');
}

/** Truncates to `maxChars` characters, appending `…` when truncation happened. */
function truncateChars(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}…`;
}

/** Truncates to `maxBytes` UTF-8 bytes, appending `…` when truncation happened. */
function truncateLineBytes(line: string, maxBytes: number): string {
    if (Buffer.byteLength(line, 'utf8') <= maxBytes) return line;

    const marker = '…';
    const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
    const truncated = Buffer.from(line, 'utf8').subarray(0, budget).toString('utf8');
    return `${truncated}${marker}`;
}

/**
 * Parses one written line back into a {@link LogEntry}.
 *
 * `text` is everything after the level token, with no attempt to re-split
 * message from meta. A line that does not match `<ts> <LEVEL> <rest>` (for
 * example a partial write) is still surfaced, with an empty `ts`/`level` and
 * the whole line as `text`, rather than dropped.
 */
function parseLine(line: string): LogEntry {
    const match = LINE_PATTERN.exec(line);
    if (match === null) return { ts: '', level: '', text: line };

    const [, ts, level, text] = match;
    if (ts === undefined || level === undefined || text === undefined) {
        return { ts: '', level: '', text: line };
    }
    return { ts, level, text };
}
