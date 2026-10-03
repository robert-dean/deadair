// The station makes the copy and decides what `share` means. What is tested here is the console's
// half: which rows offer it, what the file is called, how it leaves the browser, and which sentence a
// failure gets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError, type ScriptAttempt } from '@deadair/sdk';

import { FALLBACK_NAME, shareable, shareBreak, shareFailure, shareFileName } from '../../../src/components/scripts/break.share';

const fetchSegmentShare = vi.fn();
const saveDownload = vi.fn();

vi.mock('../../../src/api/segments.queries', () => ({
    fetchSegmentShare: (id: string) => fetchSegmentShare(id),
}));

vi.mock('../../../src/components/shared/download', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../src/components/shared/download')>()),
    saveDownload: (...args: unknown[]) => saveDownload(...args),
}));

const attempt = (over: Partial<ScriptAttempt> = {}): ScriptAttempt => ({
    id: 'att-1',
    at: DateTime.fromISO('2026-08-13T03:14:15.926Z'),
    kind: 'talkbreak',
    writer: 'model',
    outcome: 'written',
    script: 'That was Boards of Canada.',
    segmentId: 'seg-1',
    ...over,
});

const sdkError = (status: number) => new SdkError(status, 'nope', undefined, new Headers());

describe('shareable', () => {
    it('offers a written attempt whose segment is still known', () => {
        expect(shareable(attempt())).toBe(true);
    });

    it('offers nothing that never became audio, or whose segment is gone', () => {
        expect(shareable(attempt({ outcome: 'declined', script: undefined }))).toBe(false);
        expect(shareable(attempt({ outcome: 'failed', script: undefined }))).toBe(false);
        expect(shareable(attempt({ segmentId: undefined }))).toBe(false);
    });
});

describe('shareFileName', () => {
    it("keeps the station's name", () => {
        expect(shareFileName('attachment; filename="late-night-break.m4a"', 'audio/mp4')).toBe('late-night-break.m4a');
    });

    it('cleans anything that is not a plain file name character', () => {
        expect(shareFileName('attachment; filename="../Late Night: Marvin.m4a"', 'audio/mp4')).toBe('Late-Night-Marvin.m4a');
    });

    it('falls back when the station offered no name, or one with no extension', () => {
        expect(shareFileName(undefined, 'audio/mp4')).toBe(FALLBACK_NAME);
        expect(shareFileName('attachment; filename="break"', 'audio/mp4')).toBe(FALLBACK_NAME);
    });

    // An older station ignores the rendition and answers the original.
    it('takes the extension from the type the station actually answered', () => {
        expect(shareFileName('attachment; filename="break.m4a"', 'audio/wav')).toBe('break.wav');
        expect(shareFileName(undefined, 'audio/mpeg')).toBe('deadair-break.mp3');
    });
});

describe('shareFailure', () => {
    it('words what the station said', () => {
        expect(shareFailure(sdkError(404))).toBe('gone');
        expect(shareFailure(sdkError(503))).toBe('cannotCopy');
        expect(shareFailure(sdkError(500))).toBe('failed');
    });

    it('tells the station never answering apart from it refusing', () => {
        expect(shareFailure(new TypeError('Failed to fetch'))).toBe('couldNotReach');
        expect(shareFailure(new Error('no audio'))).toBe('failed');
    });
});

describe('shareBreak', () => {
    const copy = { data: new Blob(['aac'], { type: 'audio/mp4' }), contentType: 'audio/mp4', contentDisposition: 'attachment; filename="b.m4a"' };

    beforeEach(() => {
        fetchSegmentShare.mockResolvedValue(copy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    const stubShare = (share: () => Promise<void>, canShare = true) => {
        vi.stubGlobal('navigator', { ...navigator, canShare: vi.fn(() => canShare), share: vi.fn(share) });
    };

    it('hands the file to the share sheet where there is one', async () => {
        stubShare(() => Promise.resolve());

        await expect(shareBreak('seg-1')).resolves.toBe('shared');

        expect(fetchSegmentShare).toHaveBeenCalledWith('seg-1');
        const [{ files }] = vi.mocked(navigator.share).mock.calls[0] as [{ files: File[] }];
        expect(files[0]?.name).toBe('b.m4a');
        expect(files[0]?.type).toBe('audio/mp4');
        expect(saveDownload).not.toHaveBeenCalled();
    });

    // The ordinary case on a desk: no sheet at all, or not over plain HTTP.
    it('saves a download where there is no share sheet', async () => {
        vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });

        await expect(shareBreak('seg-1')).resolves.toBe('saved');

        expect(saveDownload).toHaveBeenCalledWith(copy.data, 'b.m4a', 'audio/mp4');
    });

    it('saves a download where the sheet cannot take a file', async () => {
        stubShare(() => Promise.resolve(), false);

        await expect(shareBreak('seg-1')).resolves.toBe('saved');
    });

    // The fetch can outlast the click the sheet needs, and the button must not work only on fast networks.
    it('saves a download when the sheet refuses because the click went stale', async () => {
        stubShare(() => Promise.reject(new DOMException('stale', 'NotAllowedError')));

        await expect(shareBreak('seg-1')).resolves.toBe('saved');
    });

    it('reads the sheet being dismissed as an answer rather than a failure', async () => {
        stubShare(() => Promise.reject(new DOMException('closed', 'AbortError')));

        await expect(shareBreak('seg-1')).resolves.toBe('cancelled');
        expect(saveDownload).not.toHaveBeenCalled();
    });

    it('passes on what the fetch threw', async () => {
        fetchSegmentShare.mockRejectedValue(sdkError(404));

        await expect(shareBreak('seg-1')).rejects.toBeInstanceOf(SdkError);
    });
});
