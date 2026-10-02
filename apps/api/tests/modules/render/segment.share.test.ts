// The copies listeners share: where they are kept, how long, and how one is made.
//
// The store and the sweep run against a real temp directory, because what is worth pinning is what
// happens to files: a hit refreshes the age the sweep reads, a stale copy goes and a fresh one stays,
// and an interrupted write does not linger for good. The service runs against that same real store
// with the encoder faked, because encoding is the sidecar's and the service's job is to ask for it
// once.

import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { pruneShareCopies } from '../../../src/modules/render/prune.share.copies.job.js';
import { resolveShareCopyDays } from '../../../src/modules/render/segment.share.settings.js';
import { SegmentShareService, shareFileName } from '../../../src/modules/render/segment.share.service.js';
import { SegmentShareStore, SHARE_TEMPORARY_GRACE_MS } from '../../../src/modules/render/segment.share.store.js';
import type { Segment } from '../../../src/modules/render/segment.repository.js';
import type { TranscodeOutcome } from '../../../src/modules/render/transcode.service.js';

const DAY_MS = 24 * 60 * 60_000;
const SOURCE = 'ab'.repeat(32);

let root: string;
let store: SegmentShareStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-share-test-'));
    store = new SegmentShareStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) =>
    (async function* () {
        yield new TextEncoder().encode(text);
    })();

/** Writes a copy and backdates it, as though nobody had asked for it in `ageMs`. */
async function copyAged(checksum: string, ageMs: number, now: number): Promise<string> {
    const key = store.keyFor(checksum);
    await store.writeStreamAs(key, bytes(checksum), 'm4a');
    const then = new Date(now - ageMs);
    await utimes(store.pathFor(key, 'm4a'), then, then);
    return key;
}

const configWith = (value: string | undefined) => ({ get: (_key: string, fallback: unknown) => value ?? fallback }) as unknown as AppConfig;

describe('SegmentShareStore', () => {
    it('keys a copy by the audio it was made from, so new audio is a new copy', () => {
        expect(store.keyFor(SOURCE)).toBe(store.keyFor(SOURCE));
        expect(store.keyFor(SOURCE)).not.toBe(store.keyFor('cd'.repeat(32)));
        expect(store.keyFor(SOURCE)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('marks a copy as asked for now when it is touched', async () => {
        const now = Date.now();
        const key = await copyAged(SOURCE, 30 * DAY_MS, now);

        await store.touch(key);

        expect(now - (await stat(store.pathFor(key, 'm4a'))).mtimeMs).toBeLessThan(60_000);
    });

    it('takes an old temp file for an interrupted write, and leaves a fresh one being written', async () => {
        const now = Date.now();
        await writeFile(join(root, '.tmp-old.m4a'), 'x');
        await writeFile(join(root, '.tmp-new.m4a'), 'x');
        const old = new Date(now - SHARE_TEMPORARY_GRACE_MS - 60_000);
        await utimes(join(root, '.tmp-old.m4a'), old, old);

        expect(await store.removeStaleTemporaries(now)).toBe(1);
        expect(await readdir(root)).toEqual(['.tmp-new.m4a']);
    });
});

describe('resolveShareCopyDays', () => {
    it('keeps a week when nobody says otherwise, and takes the default for text it cannot read', () => {
        expect(resolveShareCopyDays(configWith(undefined))).toBe(7);
        expect(resolveShareCopyDays(configWith('a fortnight'))).toBe(7);
        expect(resolveShareCopyDays(configWith('14'))).toBe(14);
    });

    // A cache anybody signed in can add to must not be able to grow for ever, so the "keep it all"
    // that zero means for script history is not available here.
    it('never reads zero, or anything below it, as keeping them all', () => {
        expect(resolveShareCopyDays(configWith('0'))).toBe(1);
        expect(resolveShareCopyDays(configWith('-3'))).toBe(1);
        expect(resolveShareCopyDays(configWith('100000'))).toBe(365);
    });
});

describe('pruneShareCopies', () => {
    it('removes copies nobody has asked for in the window and keeps the rest', async () => {
        const now = Date.now();
        const stale = await copyAged('11'.repeat(32), 8 * DAY_MS, now);
        const fresh = await copyAged('22'.repeat(32), 2 * DAY_MS, now);

        const summary = await pruneShareCopies(store, 7, now);

        expect(summary).toEqual({ copies: 1, temporaries: 0, days: 7 });
        expect(await store.exists(stale, 'm4a')).toBe(false);
        expect(await store.exists(fresh, 'm4a')).toBe(true);
    });

    it('leaves alone a file it did not make', async () => {
        const now = Date.now();
        await writeFile(join(root, 'notes.txt'), 'somebody put this here');
        const old = new Date(now - 30 * DAY_MS);
        await utimes(join(root, 'notes.txt'), old, old);

        await pruneShareCopies(store, 7, now);

        expect(await readdir(root)).toContain('notes.txt');
    });
});

describe('shareFileName', () => {
    it('names the file after the break, in a form every app it passes through will keep', () => {
        expect(shareFileName({ label: 'Talk break: Straight Tequila Night into My Boo' })).toBe(
            'deadair-talk-break-straight-tequila-night-into-my-boo.m4a',
        );
        expect(shareFileName({ label: 'Producer wording', listenerLabel: 'Beyoncé, then Björk' })).toBe('deadair-beyonce-then-bjork.m4a');
        expect(shareFileName({ label: '!!!' })).toBe('deadair-break.m4a');
    });
});

describe('SegmentShareService.copyOf', () => {
    const segment = { id: '11111111-1111-4111-8111-111111111111', label: 'Top of the hour', audioChecksum: SOURCE } as Segment & {
        audioChecksum: string;
    };

    const outcome = (text: string, mime = 'audio/mp4'): TranscodeOutcome => ({
        ok: true,
        copy: { mime, audio: new Response(new TextEncoder().encode(text)).body! },
    });

    function build(transcode: () => Promise<TranscodeOutcome>) {
        const transcoder = { transcode: vi.fn(transcode) };
        const signer = { sign: vi.fn((url: string) => `${url}?t=signed`) };
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;
        const service = new SegmentShareService(store, transcoder as never, signer as never, config);
        return { service, transcoder, signer };
    }

    const status = async (promise: Promise<unknown>): Promise<number | undefined> =>
        promise.then(
            () => undefined,
            (error: { statusCode?: number; status?: number }) => error.statusCode ?? error.status,
        );

    it('makes the copy once, from the station’s own signed URL, and keeps it', async () => {
        const { service, transcoder, signer } = build(async () => outcome('small'));

        const first = await service.copyOf(segment);
        const second = await service.copyOf(segment);

        expect(first.body.toString()).toBe('small');
        expect(second.body.toString()).toBe('small');
        expect(transcoder.transcode).toHaveBeenCalledTimes(1);
        expect(transcoder.transcode).toHaveBeenCalledWith('Top of the hour', expect.objectContaining({ bitrateKbps: 64, channels: 1 }));
        expect(signer.sign).toHaveBeenCalledWith(expect.stringContaining(`/segments/${segment.id}/audio`));
        expect(first.contentType).toBe('audio/mp4');
        expect(first.headers.contentDisposition).toBe('attachment; filename="deadair-top-of-the-hour.m4a"');
        expect(first.headers.etag).toBe(`"${store.keyFor(SOURCE)}"`);
    });

    it('makes one copy for two requests that arrive together', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(resolve => (release = resolve));
        const { service, transcoder } = build(async () => {
            await gate;
            return outcome('small');
        });

        const both = Promise.all([service.copyOf(segment), service.copyOf(segment)]);
        release();
        const [a, b] = await both;

        expect(transcoder.transcode).toHaveBeenCalledTimes(1);
        expect(a.body.toString()).toBe('small');
        expect(b.body.toString()).toBe('small');
    });

    it('answers 503 when the station has nothing that can make a copy, which is a state and not a fault', async () => {
        const { service } = build(async () => ({ ok: false, reason: 'none', message: 'nothing can make copies' }));
        expect(await status(service.copyOf(segment))).toBe(503);

        const { service: older } = build(async () => ({ ok: false, reason: 'unsupported', message: 'cannot' }));
        expect(await status(older.copyOf(segment))).toBe(503);
    });

    it('answers 502 when the encoder tried and failed, and keeps nothing', async () => {
        const { service } = build(async () => ({ ok: false, reason: 'failed', message: 'boom' }));

        expect(await status(service.copyOf(segment))).toBe(502);
        expect(await store.exists(store.keyFor(SOURCE), 'm4a')).toBe(false);
    });

    it('refuses a copy that is not what it was asked for, rather than storing it under the wrong name', async () => {
        const { service } = build(async () => outcome('big', 'audio/wav'));

        expect(await status(service.copyOf(segment))).toBe(502);
        expect(await store.exists(store.keyFor(SOURCE), 'm4a')).toBe(false);
    });
});
