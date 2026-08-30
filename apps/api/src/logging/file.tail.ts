import { open } from 'node:fs/promises';

/**
 * Reading the END of a log file the station does not own.
 *
 * `RotatingLogStore` reads its own files whole and is right to: rotation bounds them at
 * `maxBytes × (maxFiles + 1)`, about 8 MiB at the defaults, so `readFile` on one has a ceiling.
 * Nothing bounds the files this module is for. Liquidsoap sets `settings.log.file.append` and
 * rotates nothing (`stream/radio.liq`), and the track shim appends to one file across every
 * restart, so both grow for as long as the station runs. A `readFile` over either is a read of
 * however much disk an operator's uptime has earned, into a string, to show somebody the last
 * fifty lines of it.
 *
 * So these open the file, seek to `size - maxBytes` and read forward from there. Cost is the
 * budget rather than the file, whatever the file has grown to.
 *
 * Deliberately DI-free and config-free, like `RotatingLogStore` beside it and for a weaker reason:
 * nothing here needs a container, and a pure pair of functions over a path is testable without one.
 */

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
    const tail = await readFileTail(path, options.maxBytes);
    if (tail === undefined) return { lines: [], truncated: false };

    const lines = tail.text.split('\n').filter(line => line.length > 0);
    lines.reverse();

    return { lines: lines.slice(0, Math.max(0, Math.trunc(options.limit))), truncated: tail.truncated };
}
