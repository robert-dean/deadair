import { IsHttpError } from '@maroonedsoftware/errors';
import { describe, expect, it, vi } from 'vitest';

import { RenderService } from '../../../src/modules/render/render.service.js';
import type { SegmentLibrary } from '../../../src/modules/render/segment.library.js';
import type { Segment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import type { SegmentStore } from '../../../src/modules/render/segment.store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CHECKSUM = 'a'.repeat(64);
const BYTES = Buffer.from('a station ident');

const READY: Segment = {
    id: ID,
    kind: 'ident',
    state: 'ready',
    label: 'top of the hour',
    source: 'library',
    sourcePath: 'top-of-the-hour.mp3',
    audioChecksum: CHECKSUM,
    audioExt: 'mp3',
};

const service = (options: { segment?: Segment; segments?: Segment[]; bytes?: Buffer } = {}) => {
    const findById = vi.fn().mockResolvedValue(options.segment);
    const list = vi.fn().mockResolvedValue(options.segments ?? []);
    const read = vi.fn().mockResolvedValue(options.bytes);
    const scan = vi.fn().mockResolvedValue({ scanned: 1, imported: 1, skipped: 0 });

    return {
        service: new RenderService(
            { findById, list } as unknown as SegmentRepository,
            { read } as unknown as SegmentStore,
            {
                scan,
            } as unknown as SegmentLibrary,
        ),
        findById,
        read,
        scan,
    };
};

const status = async (promise: Promise<unknown>): Promise<number> => {
    try {
        await promise;
        return 200;
    } catch (error) {
        return IsHttpError(error) ? error.statusCode : 500;
    }
};

describe('RenderService.getSegmentAudio', () => {
    it('serves the bytes with the checksum as the validator', async () => {
        const { service: render, read } = service({ segment: READY, bytes: BYTES });

        const response = await render.getSegmentAudio(ID);

        expect(response.body).toEqual(BYTES);
        expect(response.headers.etag).toBe(`"${CHECKSUM}"`);
        expect(response.headers.cacheControl).toContain('max-age=');
        expect(read).toHaveBeenCalledWith(CHECKSUM, 'mp3');
    });

    it('404s an id nobody has', async () => {
        const { service: render, read } = service({ segment: undefined });

        expect(await status(render.getSegmentAudio(ID))).toBe(404);
        expect(read).not.toHaveBeenCalled();
    });

    // A segment with no audio is an ordinary state and not a fault: it is what everything the
    // station has not recorded yet looks like. The director skips one rather than asking for it,
    // so reaching this at all means a row changed under a commit.
    it('404s a segment that has no audio yet', async () => {
        const { service: render, read } = service({ segment: { ...READY, state: 'planned', audioChecksum: undefined, audioExt: undefined } });

        expect(await status(render.getSegmentAudio(ID))).toBe(404);
        expect(read).not.toHaveBeenCalled();
    });

    it('404s when the file has gone missing under the row', async () => {
        const { service: render } = service({ segment: READY, bytes: undefined });

        expect(await status(render.getSegmentAudio(ID))).toBe(404);
    });
});

describe('RenderService.listSegments', () => {
    it('says whether each segment can actually be played, rather than handing out a filename', async () => {
        const { service: render } = service({
            segments: [READY, { id: 'b', kind: 'talkbreak', state: 'planned', label: 'the news', source: 'render', script: 'Good evening' }],
        });

        const { segments } = await render.listSegments();

        expect(segments.map(s => s.playable)).toEqual([true, false]);
        expect(segments[0]).not.toHaveProperty('audioChecksum');
        expect(segments[1]?.script).toBe('Good evening');
    });
});

describe('RenderService.scanLibrary', () => {
    it('answers with what the pass did', async () => {
        const { service: render, scan } = service();

        expect(await render.scanLibrary()).toEqual({ scanned: 1, imported: 1, skipped: 0 });
        expect(scan).toHaveBeenCalledOnce();
    });
});
