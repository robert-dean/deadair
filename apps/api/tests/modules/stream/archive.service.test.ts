// The archive as the console reaches it: the list with its signed URLs, deleting, and the audio
// served a range at a time.
//
// Against a real temp directory through the real ArchiveStore, because the ranges are byte offsets
// into a real file, and what has to hold is that the bytes that come back are the bytes at them.

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ArchiveService, RANGE_CHUNK_BYTES, parseRange } from '../../../src/modules/stream/archive.service.js';
import { ArchiveStore } from '../../../src/modules/stream/archive.store.js';
import { verifyAudioToken } from '../../../src/modules/playout/playout.audio.token.js';
import { isSignedAudioPath } from '../../../src/server/middleware/signed.audio.middleware.js';

const SECRET = 'bridge-secret';
const SHOW = '2026-10-27T21-03-12-live';

let root: string;
let settings: Record<string, string>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-archive-service-test-'));
    settings = {};
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const config = () => ({ get: (key: string, fallback: unknown) => settings[key] ?? fallback }) as unknown as AppConfig;

function service(secret = SECRET): ArchiveService {
    return new ArchiveService(new ArchiveStore(root), { secret: () => secret } as never, config());
}

/** A finished recording whose bytes count up, so any slice of it says where it came from. */
async function recordShow(
    size: number,
    sidecar: object = { title: 'Pirate Hour', startedAtMs: Date.UTC(2026, 9, 27, 21, 3, 12), endedAtMs: Date.UTC(2026, 9, 27, 22) },
): Promise<Buffer> {
    const bytes = Buffer.from(Array.from({ length: size }, (_, i) => i % 251));
    await mkdir(join(root, '2026-10-27'), { recursive: true });
    const mp3 = join(root, '2026-10-27', '21-03-12-live.mp3');
    await writeFile(mp3, bytes);
    await writeFile(join(root, '2026-10-27', '21-03-12-live.json'), JSON.stringify(sidecar));
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(mp3, old, old);
    return bytes;
}

describe('ArchiveService.listRecordings', () => {
    it('lists each recording with a URL the audio gate will let a player through on', async () => {
        await recordShow(10);

        const list = await service().listRecordings();
        const [show] = list.recordings;

        expect(show).toMatchObject({ id: SHOW, kind: 'live', title: 'Pirate Hour', bytes: 10, recording: false });
        const url = new URL(show!.audioUrl, 'http://station');
        expect(isSignedAudioPath(url.pathname)).toBe(true);
        expect(verifyAudioToken(SECRET, url.pathname, url.searchParams.get('t') ?? '', Date.now())).toBe(true);
        // Still good hours later, for a player left paused on a long show.
        expect(verifyAudioToken(SECRET, url.pathname, url.searchParams.get('t') ?? '', Date.now() + 6 * 3600_000)).toBe(true);
    });

    it('says what the archive is set to keep, reading the stored strings', async () => {
        settings = { 'stream.archive': 'live', 'stream.archiveDays': '30' };
        expect(await service().listRecordings()).toMatchObject({ mode: 'live', retentionDays: 30, recordings: [] });

        settings = {};
        expect(await service().listRecordings()).toMatchObject({ mode: 'off', retentionDays: 14 });
    });

    it('hands out the bare path when no bridge secret is seeded, which the gate then holds to a session', async () => {
        await recordShow(10);

        const [show] = (await service('').listRecordings()).recordings;

        expect(show?.audioUrl).toBe(`/archive/recordings/${SHOW}/audio`);
    });
});

describe('ArchiveService.deleteRecording', () => {
    it('deletes a finished recording', async () => {
        await recordShow(10);

        await service().deleteRecording(SHOW);

        expect(await readdir(root)).toEqual([]);
    });

    it('answers 404 for one that is not there, including an id that tries to leave the archive', async () => {
        await expect(service().deleteRecording(SHOW)).rejects.toMatchObject({ statusCode: 404 });
        await expect(service().deleteRecording('../../etc')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('answers 409 for one still being recorded', async () => {
        await recordShow(10, { startedAtMs: Date.now() - 1000 });
        const now = new Date();
        await utimes(join(root, '2026-10-27', '21-03-12-live.mp3'), now, now);

        await expect(service().deleteRecording(SHOW)).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('ArchiveService.getRecordingAudio', () => {
    it('answers a range with exactly those bytes, as a 206', async () => {
        const bytes = await recordShow(1000);

        const answer = await service().getRecordingAudio(SHOW, {}, { range: 'bytes=100-199' });

        expect(answer.status).toBe(206);
        expect(answer.headers).toMatchObject({ acceptRanges: 'bytes', contentRange: 'bytes 100-199/1000' });
        expect(answer.body.equals(bytes.subarray(100, 200))).toBe(true);
    });

    it("answers a player's open-ended first request with one chunk, not the whole file", async () => {
        const size = RANGE_CHUNK_BYTES + 5000;
        const bytes = await recordShow(size);

        const answer = await service().getRecordingAudio(SHOW, {}, { range: 'bytes=0-' });

        expect(answer.status).toBe(206);
        expect(answer.body.length).toBe(RANGE_CHUNK_BYTES);
        expect(answer.headers).toMatchObject({ contentRange: `bytes 0-${RANGE_CHUNK_BYTES - 1}/${size}` });
        expect(answer.body.equals(bytes.subarray(0, RANGE_CHUNK_BYTES))).toBe(true);
    });

    it('answers the whole file with no range, and as a named attachment when asked to download', async () => {
        const bytes = await recordShow(300);

        const plain = await service().getRecordingAudio(SHOW, {}, {});
        expect(plain.status).toBe(200);
        expect(plain.body.equals(bytes)).toBe(true);

        // A download ignores any range: it is the file, saved under a name a person would give it.
        const download = await service().getRecordingAudio(SHOW, { download: true }, { range: 'bytes=0-9' });
        expect(download.status).toBe(200);
        expect(download.body.length).toBe(300);
        expect(download.status === 200 && download.headers.contentDisposition).toMatch(
            /^attachment; filename="2026-10-27 \d\d\.\d\d Pirate Hour\.mp3"; filename\*=UTF-8''/,
        );
    });

    it('keeps an operator-typed title from becoming structure in the filename', async () => {
        await recordShow(10, { title: 'A/B "live" \\ show\r\nX-Evil: 1', startedAtMs: 1, endedAtMs: 2 });

        const answer = await service().getRecordingAudio(SHOW, { download: true }, {});
        const disposition = answer.status === 200 ? (answer.headers.contentDisposition ?? '') : '';

        expect(disposition).not.toMatch(/[\r\n]/);
        expect(disposition.match(/filename="([^"]*)"/)?.[1]).not.toMatch(/[/\\"]/);
    });

    it('refuses a range that starts past the end with a 416', async () => {
        await recordShow(100);

        await expect(service().getRecordingAudio(SHOW, {}, { range: 'bytes=100-' })).rejects.toMatchObject({ statusCode: 416 });
    });

    it('answers 404 for a recording that is not there', async () => {
        await expect(service().getRecordingAudio(SHOW, {}, {})).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('parseRange', () => {
    it('reads the three single-range forms', () => {
        expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
        expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
        expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
        expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    });

    it('answers the whole file for what it does not support, and refuses only a start past the end', () => {
        expect(parseRange(undefined, 100)).toBeUndefined();
        expect(parseRange('bytes=0-1,5-6', 100)).toBeUndefined();
        expect(parseRange('items=0-1', 100)).toBeUndefined();
        expect(parseRange('bytes=20-10', 100)).toBeUndefined();
        expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
        expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    });
});
