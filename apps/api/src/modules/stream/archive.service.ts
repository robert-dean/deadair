import { open } from 'node:fs/promises';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { stationZone } from '#modules/director/clock.words.js';
import { LiquidsoapEndpoint } from '#modules/playout/liquidsoap.endpoint.js';
import { AUDIO_TOKEN_PARAM, signAudioPath } from '#modules/playout/playout.audio.token.js';
import { ArchiveStore, type Recording as StoredRecording } from './archive.store.js';
import { parseArchiveMode, resolveArchiveDays } from './archive.settings.js';
import { STREAM_KEYS } from './stream.settings.js';
import type { Recording, RecordingList } from './types/stream.archive.types.js';

/**
 * How long a recording's audio URL stays good.
 *
 * Longer than the hour every other signed audio URL gets, because this one is the `src` of a player
 * an operator may leave paused on a two-hour show: a browser fetches the rest of the file in ranges
 * as it plays, and every one of those requests is checked against the token minted when the page
 * listed the recording.
 */
export const RECORDING_URL_TTL_MS = 12 * 60 * 60_000;

/**
 * The most bytes one ranged answer carries.
 *
 * A browser opens an MP3 with `Range: bytes=0-`, asking for all of it, and the generated router
 * answers with a whole `Buffer`. Answering that range with up to 2 MB is allowed (RFC 9110 lets a
 * server send less than was asked for), and the player asks for the next piece as it gets there,
 * so an hour of audio is never held in memory to play a minute of it.
 */
export const RANGE_CHUNK_BYTES = 2 * 1024 * 1024;

type AudioAnswer =
    | { status: 200; contentType: 'audio/mpeg'; body: Buffer; headers: { acceptRanges?: string; contentDisposition?: string } }
    | { status: 206; contentType: 'audio/mpeg'; body: Buffer; headers: { acceptRanges?: string; contentRange: string } };

/**
 * The archive, for the console: what was recorded, its audio, and deleting it.
 *
 * Reads through {@link ArchiveStore}, which reads the files Liquidsoap wrote, so there is no state
 * here and nothing to fall out of step.
 */
@Injectable()
export class ArchiveService {
    constructor(
        private readonly store: ArchiveStore,
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly config: AppConfig,
    ) {}

    async listRecordings(): Promise<RecordingList> {
        const now = Date.now();
        const recordings = await this.store.list(now);

        return {
            mode: parseArchiveMode(this.config.get(STREAM_KEYS.archive, 'off')),
            retentionDays: resolveArchiveDays(this.config),
            recordings: recordings.map(recording => this.describe(recording, now)),
        };
    }

    async deleteRecording(id: string): Promise<void> {
        const recording = await this.store.get(id);
        if (recording === undefined) throw httpError(404).withDetails({ message: `no recording "${id}"` });
        if (recording.recording) throw httpError(409).withDetails({ message: `recording "${id}" is still being recorded` });

        if (!(await this.store.remove(id))) throw httpError(404).withDetails({ message: `no recording "${id}"` });
    }

    async getRecordingAudio(id: string, query: { download?: boolean }, headers: { range?: string }): Promise<AudioAnswer> {
        const recording = await this.store.get(id);
        const path = this.store.pathFor(id);
        if (recording === undefined || path === undefined) throw httpError(404).withDetails({ message: `no recording "${id}"` });

        const file = await open(path, 'r');
        try {
            // The size NOW rather than the listing's, because a recording still being written grows
            // between the two, and a range past the old end is not past the new one.
            const size = (await file.stat()).size;
            const range = query.download === true ? undefined : parseRange(headers.range, size);

            if (range === 'unsatisfiable') {
                throw httpError(416).withDetails({ message: `range "${headers.range}" is outside a ${size}-byte recording` });
            }

            if (range === undefined) {
                const body = Buffer.alloc(size);
                await file.read(body, 0, size, 0);
                return {
                    status: 200,
                    contentType: 'audio/mpeg',
                    body,
                    headers: {
                        acceptRanges: 'bytes',
                        ...(query.download === true ? { contentDisposition: attachment(recording, stationZone(this.config)) } : {}),
                    },
                };
            }

            const end = Math.min(range.end, range.start + RANGE_CHUNK_BYTES - 1);
            const body = Buffer.alloc(end - range.start + 1);
            await file.read(body, 0, body.length, range.start);
            return {
                status: 206,
                contentType: 'audio/mpeg',
                body,
                headers: { acceptRanges: 'bytes', contentRange: `bytes ${range.start}-${end}/${size}` },
            };
        } finally {
            await file.close();
        }
    }

    private describe(recording: StoredRecording, now: number): Recording {
        return {
            id: recording.id,
            kind: recording.kind,
            ...(recording.title !== undefined ? { title: recording.title } : {}),
            startedAt: recording.startedAt,
            ...(recording.endedAt !== undefined ? { endedAt: recording.endedAt } : {}),
            bytes: recording.bytes,
            recording: recording.recording,
            audioUrl: this.audioUrl(recording.id, now),
        };
    }

    /**
     * The audio route for one recording, signed the way `signed.audio.middleware` checks, so an
     * `<audio src>` with no bearer token can stream it. Unsigned on a station whose bridge secret is
     * not seeded yet, which the middleware then answers with the session it asks for anyway.
     */
    private audioUrl(id: string, now: number): string {
        const path = `/archive/recordings/${id}/audio`;
        const secret = this.endpoint.secret();
        if (secret.length === 0) return path;

        return `${path}?${AUDIO_TOKEN_PARAM}=${encodeURIComponent(signAudioPath(secret, path, now + RECORDING_URL_TTL_MS))}`;
    }
}

/**
 * One byte range out of a `Range` header, inclusive at both ends, or `undefined` for no usable range.
 *
 * A single `bytes=` range in any of its three forms (`a-b`, `a-`, `-n`). Several ranges, other units
 * and anything malformed are answered with the whole file, which RFC 9110 allows a server to do with
 * any range it does not support. A range that starts past the end is the one refusal.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
    if (match === null) return undefined;

    const [, from = '', to = ''] = match;
    if (from === '' && to === '') return undefined;

    if (from === '') {
        // A suffix: the last n bytes.
        const length = Number(to);
        if (length === 0) return 'unsatisfiable';
        return { start: Math.max(0, size - length), end: size - 1 };
    }

    const start = Number(from);
    if (start >= size) return 'unsatisfiable';
    const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
    return end < start ? undefined : { start, end };
}

/**
 * `attachment` with a name a person would give the file: the date, the time, and the show.
 *
 * On the STATION's clock, which is the one the show was booked and announced in. The process's own
 * zone is UTC in the image, which named a 21:03 show `01.03` on the next day. A zone the platform
 * does not know falls back to the process's rather than naming the file "Invalid DateTime".
 */
function attachment(recording: StoredRecording, zone: string): string {
    const zoned = recording.startedAt.setZone(zone);
    const when = (zoned.isValid ? zoned : recording.startedAt).toFormat("yyyy-LL-dd HH'.'mm");
    const what = recording.title ?? (recording.kind === 'live' ? 'Live show' : 'Programme');
    // The title is whatever an operator typed, so nothing a filesystem or a header could read as
    // structure survives into the name: no separators, no quotes, no control characters.
    const name = `${when} ${what}`.replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-') + '.mp3';
    // A plain-ASCII fallback for old clients beside the UTF-8 name every browser reads. RFC 8187's
    // attr-char excludes the five characters `encodeURIComponent` leaves alone, so those are encoded too.
    const ascii = name.replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
