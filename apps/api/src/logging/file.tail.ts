import { open, stat } from 'node:fs/promises';

/**
 * Reading the END of a log file the station does not own.
 *
 * `RotatingLogStore` reads its own files whole and is right to: rotation bounds them at
 * `maxBytes × (maxFiles + 1)`, about 8 MiB at the defaults, so `readFile` on one has a ceiling.
 * The files this module is for are written by Liquidsoap and by the track shim, in formats this
 * app does not own, and until the image rotated them they grew for as long as the station ran. A
 * `readFile` over either was a read of however much disk an operator's uptime had earned, into a
 * string, to show somebody the last fifty lines of it.
 *
 * So these open the file, seek to `size - maxBytes` and read forward from there. Cost is the
 * budget rather than the file, whatever the file has grown to. That bound is kept even now the
 * image rotates them, because the app cannot assume the deployment it is reading: the compose
 * tree, an operator who set `LOG_ROTATE_INTERVAL_S=0`, and any install older than rotation all
 * still present one unbounded file.
 *
 * ## Segments
 *
 * Rotation splits the history the console used to read out of one file across several, so a reader
 * that knows only about the active file would show LESS after rotation than before — and would
 * show almost nothing in the minutes after a rotation, which is exactly when somebody is looking.
 * {@link readSegmentedTail} walks `name.log`, `name.log.1`, `name.log.2`… newest first until the
 * budget runs out, so the answer is the newest `maxBytes` of retained history wherever it happens
 * to live. That keeps the console's view identical to what an unbounded file gave it.
 *
 * **The segments must not be compressed.** `.1.gz` is not a file this reads, and a reader that
 * silently skipped one would report a gap in the history as though it were quiet. The rotation
 * config in `docker/rootfs/etc/s6-overlay/s6-rc.d/log-rotate/run` says the same thing from the
 * other side; the two are a pair.
 *
 * Deliberately DI-free and config-free, like `RotatingLogStore` beside it and for a weaker reason:
 * nothing here needs a container, and pure functions over a path are testable without one.
 */

/**
 * How many rotated segments a walk will look at before it stops.
 *
 * Generous against the four the image keeps (`rotate 3` plus the active file) and bounded anyway,
 * because the walk is over names this app predicts rather than a directory it read: a budget large
 * enough to exhaust an operator's whole retention must still stop.
 */
const MAX_SEGMENTS = 32;

/** The `index`th file of a rotated set, where zero is the active one. logrotate's own naming. */
function segmentPath(path: string, index: number): string {
    return index === 0 ? path : `${path}.${index}`;
}

/** What a bounded read of a file's end came back with. */
export interface FileTail {
    /** The bytes read, decoded as UTF-8, with any partial leading line already dropped. */
    text: string;
    /** Whether the file was longer than the budget, so what is here starts mid-file. */
    truncated: boolean;
}

/** A bounded read of a file's end, split into lines. */
export interface FileTailLines {
    /** The last lines of the file, NEWEST FIRST, at most `limit` of them. */
    lines: string[];
    /** Whether the read hit the byte budget, so the oldest line here is not the file's first. */
    truncated: boolean;
}

/**
 * The last `maxBytes` of a file, or `undefined` if there is no file to read.
 *
 * A missing file is the ordinary state rather than a fault — a station that has never run
 * Liquidsoap has no Liquidsoap log — so it answers `undefined` on the same rule
 * `listSegmentsByMtime` follows in `rotating.log.store.ts`: a reader of somebody else's files must
 * never turn their absence into an error the caller has to handle. An unreadable file (permissions,
 * a disk fault) answers the same way, because the caller can do nothing different with either.
 *
 * When the budget cut the head off, everything up to and including the first newline is dropped.
 * Seeking to a byte offset lands in the middle of a line essentially always, and half a log line
 * displayed as a whole one is worse than one fewer line: it reads as a message the process actually
 * wrote. That drop is also what makes a multi-byte character at the seek point harmless — the
 * replacement character it decodes to is inside the fragment being discarded.
 */
export async function readFileTail(path: string, maxBytes: number): Promise<FileTail | undefined> {
    let handle;
    try {
        handle = await open(path, 'r');
    } catch {
        return undefined;
    }

    try {
        const { size } = await handle.stat();
        if (size === 0) return { text: '', truncated: false };

        const budget = Math.max(0, Math.trunc(maxBytes));
        const start = Math.max(0, size - budget);
        const length = size - start;

        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);

        const raw = buffer.subarray(0, bytesRead).toString('utf8');
        if (start === 0) return { text: raw, truncated: false };

        const firstBreak = raw.indexOf('\n');
        return { text: firstBreak === -1 ? '' : raw.slice(firstBreak + 1), truncated: true };
    } catch {
        return undefined;
    } finally {
        await handle.close().catch(() => undefined);
    }
}

/**
 * {@link readFileTail} split into at most `limit` lines, newest first.
 *
 * Newest first because that is what this API answers with everywhere — `getPluginLogs` says so at
 * length, and the activity feed and the script history send the same way. Empty lines are dropped,
 * matching `RotatingLogStore.tail`: a trailing newline is punctuation rather than a line the
 * process wrote.
 *
 * A missing file answers an empty list rather than being distinguishable from an empty one. The
 * caller that needs to tell those apart is asking whether the SOURCE exists, which is a `stat`
 * question and not this one.
 */
export async function tailFileLines(path: string, options: { maxBytes: number; limit: number }): Promise<FileTailLines> {
    const tail = await readSegmentedTail(path, options.maxBytes);
    if (tail === undefined) return { lines: [], truncated: false };

    const lines = tail.text.split('\n').filter(line => line.length > 0);
    lines.reverse();

    return { lines: lines.slice(0, Math.max(0, Math.trunc(options.limit))), truncated: tail.truncated };
}

/**
 * The last `maxBytes` of a rotated set, oldest first, or `undefined` when none of it is there.
 *
 * Walks the active file and then its rotated segments, newest first, spending the budget as it
 * goes and stopping at the first one it could not read whole. The result reads as one file, which
 * is what it was before something rotated it.
 *
 * Two absences mean different things and the walk treats them so. The ACTIVE file being missing is
 * not the end: logrotate's `copytruncate` always leaves one, but a `create`-style rotation between
 * the copy and the recreate does not, and stopping there would report a station with four retained
 * segments as having no log at all. A missing SEGMENT is the end, because they are numbered
 * contiguously from one and a gap is the retention limit rather than a hole to read past.
 *
 * `truncated` falls out of the walk rather than being computed: a budget spent to nothing makes the
 * next {@link readFileTail} answer an empty truncated read, which is the correct answer for "there
 * is older history here and none of it fits". An empty segment is not truncation, which is why the
 * loop goes on past one.
 */
export async function readSegmentedTail(path: string, maxBytes: number): Promise<FileTail | undefined> {
    const parts: string[] = [];
    let remaining = Math.max(0, Math.trunc(maxBytes));
    let truncated = false;
    let found = false;

    for (let index = 0; index <= MAX_SEGMENTS; index++) {
        const tail = await readFileTail(segmentPath(path, index), remaining);

        if (tail === undefined) {
            if (index === 0) continue;
            break;
        }

        found = true;
        if (tail.text.length > 0) parts.push(tail.text);

        if (tail.truncated) {
            truncated = true;
            break;
        }

        remaining -= Buffer.byteLength(tail.text, 'utf8');
    }

    if (!found) return undefined;

    parts.reverse();
    return { text: parts.join(''), truncated };
}

/**
 * The total size of a rotated set and the newest write across it, or `undefined` when it is absent.
 *
 * What the console reports as the log's size, and the reason it is a sum: an operator looking at
 * "8 MB" next to a source that has 32 MB on their disk is being told the wrong thing about their
 * own storage. Follows the same two absence rules as {@link readSegmentedTail}, and counts nothing
 * it could not stat, on `measureStore`'s rule that a segment which rotated away mid-walk is not a
 * fault.
 */
export async function measureSegments(path: string): Promise<{ bytes: number; lastWriteAt: number } | undefined> {
    let bytes = 0;
    let newest: number | undefined;

    for (let index = 0; index <= MAX_SEGMENTS; index++) {
        let stats;
        try {
            stats = await stat(segmentPath(path, index));
        } catch {
            if (index === 0) continue;
            break;
        }

        bytes += stats.size;
        newest = newest === undefined ? stats.mtimeMs : Math.max(newest, stats.mtimeMs);
    }

    if (newest === undefined) return undefined;
    return { bytes, lastWriteAt: newest };
}
