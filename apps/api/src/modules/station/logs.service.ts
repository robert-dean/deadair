import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { httpError } from '@maroonedsoftware/errors';
import { errorText } from '#modules/shared/error.text.js';
import { getLogStore } from '#src/logging/log.store.js';
import { readFileTail, tailFileLines } from '#src/logging/file.tail.js';
import { LOG_SOURCES, logSourceById, logSourcePath, type LogSourceDescriptor } from './logs.sources.js';
import type { LogLevel, LogLine, LogPage, LogQuery, LogSource, LogSourceList } from './types/logs.types.js';

/** How many lines a tail answers with when the caller does not say. `RotatingLogStore`'s own default. */
const DEFAULT_LIMIT = 200;

/**
 * How much of an unbounded file a tail is allowed to read.
 *
 * Only `kind: 'file'` sources need a budget at all — the store's own files are bounded by rotation.
 * Half a megabyte is several thousand log lines, which is more than the 2000 the query's `limit`
 * caps at, so this bites only on a file whose lines are unusually long.
 */
const TAIL_BUDGET_BYTES = 512 * 1024;

/**
 * How much of an unbounded file a download is allowed to read.
 *
 * Deliberately the same figure the app's own log is bounded at by rotation
 * (`LOG_MAX_BYTES × (LOG_MAX_FILES + 1)`, 8 MiB at the defaults), so the two kinds of source hand
 * back files of comparable size and neither can put an operator's whole uptime into one response.
 */
const DOWNLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

/** The levels a line may be tagged with, for turning the store's written token back into one. */
const LOG_LEVELS = new Set<string>(['trace', 'debug', 'info', 'warn', 'error']);

/**
 * What a stamp `RotatingLogStore` wrote looks like, so one it merely FOUND can be told apart.
 *
 * `parseLine` splits on `<non-space> <non-space> <rest>` and calls the first two the stamp and the
 * level, which is right for a line that store wrote and produces confident nonsense for one it did
 * not — `half a line` parses as a decision at `half`. Nothing else writes into `api.log` today, so
 * this is a guard rather than a fix for something live, but an optional field that means "the first
 * word of the line" is worse than one that is absent.
 */
const ISO_STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * The console's reader over the log files this install has.
 *
 * ## What it is for
 *
 * `/plugins/{id}/logs` has always served a plugin's own channel and nothing served the station's,
 * so the one log carrying every subsystem could be read only by somebody with a shell on the box.
 * This is that route, plus the two the audio chain writes, which `stream/radio.liq` says were put
 * on disk so all three could be read on one timeline.
 *
 * ## Why it reaches the store through `getLogStore()`
 *
 * The same reason `LoggingModule` does, and that file argues it at length: the `RotatingLogStore`
 * DI token is registered by `PluginsModule`, so resolving it from here would make the station's
 * diagnostics depend on a registration made by the plugin host. The process-wide holder is the
 * authority; the container entry is a convenience for the module that registered it. An absent
 * store means setup never ran, which outside a test is a boot that failed before it got here.
 *
 * ## Nothing here fails the page
 *
 * `TracesService`'s rule next door, and it applies harder: a station whose stream has never run has
 * no stream logs, and a station reading somebody else's file has no say in whether it is readable.
 * Both answer "not present" rather than throwing, because an operator opening this page is already
 * looking into something and a 500 tells them less than an empty list does. The one thing that IS
 * an error is an id that names no source at all, which is a caller bug rather than a station state.
 */
@Injectable()
export class LogsService {
    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Every source, present or not, with its size and when it was last written. */
    async listSources(): Promise<LogSourceList> {
        return { sources: await Promise.all(LOG_SOURCES.map(source => this.describe(source))) };
    }

    /**
     * A tail of one source, newest first.
     *
     * Newest first is this API's own shape rather than the file's, exactly as `getPluginLogs`
     * argues: a file is written oldest-first and what somebody opening this page wants is what just
     * happened, at the top. The DOWNLOAD is untouched and stays the file as written.
     *
     * `level` reaches the store, which filters on minimum severity as it reads. It does NOT reach a
     * file source, whose lines this app did not write and cannot grade — and the answer says so by
     * leaving `level` absent, so a filter that did nothing cannot look as though it worked.
     *
     * @throws 404 no source by that id.
     */
    async readLog(id: string, query: LogQuery): Promise<LogPage> {
        const source = this.requireSource(id);
        const limit = query.limit ?? DEFAULT_LIMIT;

        if (source.kind === 'store') {
            const store = getLogStore();
            if (store === undefined) return { sourceId: source.id, truncated: false, lines: [] };

            const raw = await store.tail(undefined, { limit, ...(query.level === undefined ? {} : { level: query.level }) });
            const lines = raw.map(entry => asLine(entry.ts, entry.level, entry.text));
            lines.reverse();

            // Rotation is the bound, so a tail of a store source is never a partial read of a
            // longer whole in the way a byte budget makes one.
            return {
                sourceId: source.id,
                ...(query.level === undefined ? {} : { level: query.level }),
                truncated: false,
                lines,
            };
        }

        const path = logSourcePath(source, this.config);
        if (path === undefined) return { sourceId: source.id, truncated: false, lines: [] };

        const tail = await tailFileLines(path, { maxBytes: TAIL_BUDGET_BYTES, limit });
        return { sourceId: source.id, truncated: tail.truncated, lines: tail.lines.map(text => ({ text })) };
    }

    /**
     * One source's retained log as a plain-text attachment, oldest first, as the file is written.
     *
     * The filename is built from the TABLE's id and never from the request. `downloadPluginLogs`
     * has to sanitize, because a plugin id comes out of a third-party manifest; here
     * {@link requireSource} has already rejected anything that is not one of three literals this
     * repository wrote, so there is nothing left to inject with.
     *
     * @throws 404 no source by that id.
     */
    async downloadLog(id: string): Promise<{ body: string; headers: { contentDisposition: string } }> {
        const source = this.requireSource(id);
        const headers = { contentDisposition: `attachment; filename="deadair-${source.id}.log"` };

        if (source.kind === 'store') {
            const store = getLogStore();
            return { body: store === undefined ? '' : await store.readAll(undefined), headers };
        }

        const path = logSourcePath(source, this.config);
        const tail = path === undefined ? undefined : await readFileTail(path, DOWNLOAD_BUDGET_BYTES);
        return { body: tail?.text ?? '', headers };
    }

    /** The descriptor for `id`. */
    private requireSource(id: string): LogSourceDescriptor {
        const source = logSourceById(id);
        if (source === undefined) throw httpError(404).withDetails({ message: `no log source "${id}"` });
        return source;
    }

    /** One source's size and last write, or the absent state when there is nothing on disk yet. */
    private async describe(source: LogSourceDescriptor): Promise<LogSource> {
        const base = { id: source.id, label: source.label, description: source.description, levels: source.levels };

        const measured = source.kind === 'store' ? await this.measureStore() : await this.measureFile(source);
        if (measured === undefined) return { ...base, present: false, bytes: 0 };

        return {
            ...base,
            present: true,
            bytes: measured.bytes,
            // Absent rather than null when nothing has been written, on this repository's
            // row-mapper convention: an optional the reader does not have is dropped, never passed
            // through as a third state.
            ...(measured.lastWriteAt === undefined ? {} : { lastWriteAt: measured.lastWriteAt }),
        };
    }

    /**
     * The app channel's size across every retained segment.
     *
     * Files directly in `LOGS_DIR` and no deeper, which is the same boundary `RotatingLogStore.clear`
     * draws for this channel and for the same reason: the root doubles as the parent of the plugin
     * channels' directories, and of `traces/` and `captures/`, none of which are this source.
     */
    private async measureStore(): Promise<{ bytes: number; lastWriteAt?: DateTime } | undefined> {
        const root = resolve(String(this.config.get('LOGS_DIR', './logs')));

        let entries;
        try {
            entries = await readdir(root, { withFileTypes: true });
        } catch {
            // No directory yet, which is a process that has not written its first line.
            return undefined;
        }

        let bytes = 0;
        let newest: number | undefined;
        let found = false;

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            try {
                const stats = await stat(join(root, entry.name));
                bytes += stats.size;
                newest = newest === undefined ? stats.mtimeMs : Math.max(newest, stats.mtimeMs);
                found = true;
            } catch {
                // A segment that rotated away mid-read is not a fault; it is simply not counted.
            }
        }

        if (!found) return undefined;
        return { bytes, ...(newest === undefined ? {} : { lastWriteAt: DateTime.fromMillis(newest) }) };
    }

    /** One foreign file's size and last write, or nothing when it is not there. */
    private async measureFile(source: LogSourceDescriptor): Promise<{ bytes: number; lastWriteAt?: DateTime } | undefined> {
        const path = logSourcePath(source, this.config);
        if (path === undefined) return undefined;

        try {
            const stats = await stat(path);
            return { bytes: stats.size, lastWriteAt: DateTime.fromMillis(stats.mtimeMs) };
        } catch (error) {
            // ENOENT is the ordinary case and says nothing; anything else is worth a line, because a
            // log an operator cannot read for a reason other than absence is itself a finding.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.logger.warn(`station: could not stat the ${source.id} log (${errorText(error)})`, { path });
            }
            return undefined;
        }
    }
}

/**
 * One line the store read back, as the API answers it.
 *
 * A stamp that does not look like one is a line the store's regex split rather than parsed, so the
 * three parts are put back together and answered raw. Rejoining loses the level token's padding and
 * nothing else — and that padding only ever exists on a line whose stamp IS a stamp, which is the
 * branch above. A level the store wrote but this vocabulary does not have (`NOTICE`, from some
 * future caller) keeps the stamp and drops the tag, rather than being downgraded to raw.
 */
function asLine(ts: string, level: string, text: string): LogLine {
    if (!ISO_STAMP_PATTERN.test(ts)) {
        return { text: [ts, level, text].filter(part => part.length > 0).join(' ') };
    }

    const named = level.toLowerCase();
    return { ts, ...(LOG_LEVELS.has(named) ? { level: named as LogLevel } : {}), text };
}
