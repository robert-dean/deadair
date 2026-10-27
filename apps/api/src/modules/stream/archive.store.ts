import { readdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DateTime } from 'luxon';

/** What a recording holds: a live show, or an hour of the station's own programme. */
export type RecordingKind = 'live' | 'hour';

/** One file in the archive, as its sidecar and the filesystem describe it together. */
export interface Recording {
    /** `<day>T<time>-<kind>`, e.g. `2026-10-27T21-03-12-live`. Names the file and nothing else can. */
    id: string;
    kind: RecordingKind;
    /** The show's name for a live one, as it was armed. Absent for an hour, or a show armed with none. */
    title?: string;
    startedAt: DateTime;
    /** Absent while the file is still being written. */
    endedAt?: DateTime;
    bytes: number;
    /** Still being written: no end in its sidecar, and the file moved within {@link IN_PROGRESS_GRACE_MS}. */
    recording: boolean;
}

/**
 * How recently a file with no end must have grown to be one still being written.
 *
 * `radio.liq` writes the end into the sidecar when it closes a file. A file with no end that has not
 * grown for this long was cut short (a crash, a SIGKILL) rather than open, and its last write is the
 * nearest thing to when it ended. A minute is far past the encoder's flush interval and far below
 * anything an operator would notice.
 */
export const IN_PROGRESS_GRACE_MS = 60_000;

/**
 * The strict shape of an id, and the only route from one to a path.
 *
 * Nothing that does not match is ever joined onto the root, so an id cannot climb out of it however
 * it is spelled: there is no `..`, no separator and no encoding this accepts.
 */
const ID_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})-(live|hour)$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PATTERN = /^(\d{2}-\d{2}-\d{2})-(live|hour)\.mp3$/;

interface Sidecar {
    title?: unknown;
    startedAtMs?: unknown;
    endedAtMs?: unknown;
}

/**
 * The archive on disk: what Liquidsoap recorded, read back.
 *
 * ## The files are the truth, and there is no table
 *
 * Liquidsoap writes `<root>/<day>/<time>-<kind>.mp3` and a JSON sidecar beside each (see "The
 * archive" in `stream/README.md`). Nothing else writes here and the sweep is the only thing that
 * deletes, so a row per recording would be a second copy of the directory listing that could only
 * ever disagree with it.
 *
 * Not a `ContentStore`: those are addressed by checksum and claimed by rows, and a recording is
 * addressed by when it was made.
 */
export class ArchiveStore {
    constructor(readonly root: string) {}

    /** Every recording, newest first. A missing archive directory is an empty archive. */
    async list(now: number = Date.now()): Promise<Recording[]> {
        const found: Recording[] = [];

        for (const day of await entries(this.root)) {
            if (!DAY_PATTERN.test(day)) continue;

            for (const name of await entries(join(this.root, day))) {
                const [, time, kind] = FILE_PATTERN.exec(name) ?? [];
                if (time === undefined || kind === undefined) continue;

                const recording = await this.read(`${day}T${time}-${kind}`, now);
                if (recording !== undefined) found.push(recording);
            }
        }

        return found.sort((a, b) => b.startedAt.toMillis() - a.startedAt.toMillis());
    }

    /** One recording by its id, or `undefined` for an id that is malformed or names nothing. */
    async get(id: string, now: number = Date.now()): Promise<Recording | undefined> {
        return ID_PATTERN.test(id) ? await this.read(id, now) : undefined;
    }

    /** Where a recording's MP3 is, or `undefined` for an id that is not one. Never outside the root. */
    pathFor(id: string): string | undefined {
        const [, day, time, kind] = ID_PATTERN.exec(id) ?? [];
        return day === undefined || time === undefined || kind === undefined ? undefined : join(this.root, day, `${time}-${kind}.mp3`);
    }

    /**
     * Removes a recording and its sidecar, and its day's directory once that is empty. Says whether
     * there was anything to remove.
     *
     * Refuses one still being written: Liquidsoap holds it open, and unlinking it would leave the
     * encoder writing an hour of audio into a file nothing can reach.
     */
    async remove(id: string, now: number = Date.now()): Promise<boolean> {
        const recording = await this.get(id, now);
        const path = this.pathFor(id);
        if (recording === undefined || path === undefined || recording.recording) return false;

        await rm(path, { force: true });
        await rm(sidecarPath(path), { force: true });
        // Only succeeds when the day is empty, which is the only case it should.
        await rmdir(join(path, '..')).catch(() => {});

        return true;
    }

    private async read(id: string, now: number): Promise<Recording | undefined> {
        const path = this.pathFor(id);
        if (path === undefined) return undefined;

        const info = await stat(path).catch(() => undefined);
        if (info === undefined) return undefined;

        const sidecar = await readSidecar(sidecarPath(path));
        // `pathFor` matched the pattern, so the id ends in one of the two kinds.
        const kind: RecordingKind = id.endsWith('-live') ? 'live' : 'hour';
        const title = typeof sidecar.title === 'string' && sidecar.title.trim() !== '' ? sidecar.title : undefined;
        const started = millis(sidecar.startedAtMs) ?? info.birthtimeMs;
        const ended = millis(sidecar.endedAtMs);
        // A file with no end is being written only while it is still growing; otherwise it was cut
        // short, and the last time it grew is when.
        const stillGrowing = ended === undefined && now - info.mtimeMs < IN_PROGRESS_GRACE_MS;
        const endedAt = ended ?? (stillGrowing ? undefined : info.mtimeMs);

        return {
            id,
            kind,
            ...(title !== undefined ? { title } : {}),
            startedAt: DateTime.fromMillis(started),
            ...(endedAt !== undefined ? { endedAt: DateTime.fromMillis(endedAt) } : {}),
            bytes: info.size,
            recording: stillGrowing,
        };
    }
}

function sidecarPath(mp3: string): string {
    return mp3.replace(/\.mp3$/, '.json');
}

async function entries(dir: string): Promise<string[]> {
    return await readdir(dir).catch(() => []);
}

/** The sidecar, or nothing at all: one that is missing or half-read is the same as none. */
async function readSidecar(path: string): Promise<Sidecar> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
        return typeof parsed === 'object' && parsed !== null ? (parsed as Sidecar) : {};
    } catch {
        return {};
    }
}

function millis(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
