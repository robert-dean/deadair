import type { ScriptAttempt } from '@deadair/sdk';

import { fetchSegmentShare } from '../../api/segments.queries';
import { sdkError } from '../../api/sdk.error';
import { downloadFilename, saveDownload } from '../shared/download';

/**
 * Sending a talk break somewhere else: the console's half of what the Android app does from the same
 * list.
 *
 * The station makes the copy (`GET /segments/{id}/audio?rendition=share`, AAC sized for a text
 * message) and the console only asks for it, so what is decided here is which rows can be shared,
 * what the file is called on the way out, how it leaves the browser, and what to say when it does not.
 */

/** The name a copy gets when the station did not offer one. Android's, so the two send the same file. */
export const FALLBACK_NAME = 'deadair-break.m4a';

/**
 * Whether a row has audio to share: words were written, and the segment they became is still known. A
 * declined or failed attempt never became audio, and a row that outlived its segment has nothing to
 * fetch.
 */
export function shareable(attempt: ScriptAttempt): attempt is ScriptAttempt & { segmentId: string } {
    return attempt.outcome === 'written' && attempt.segmentId !== undefined;
}

const EXTENSION: Record<string, string> = {
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
};

/**
 * The file name, from the station's `content-disposition` when it sent one.
 *
 * Cleaned rather than trusted, on Android's rule: anything but letters, digits, dots, dashes and
 * underscores goes, and a name that cleans down to nothing usable falls back. An older station that
 * ignored the rendition and sent the original gets its extension from the type it actually answered.
 */
export function shareFileName(contentDisposition: string | undefined, contentType: string): string {
    const cleaned = downloadFilename(contentDisposition, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '');
    const name = cleaned.includes('.') ? cleaned : FALLBACK_NAME;
    const extension = EXTENSION[contentType] ?? name.slice(name.lastIndexOf('.') + 1);
    return `${name.slice(0, name.lastIndexOf('.'))}.${extension}`;
}

/** Which sentence a failed share gets, as a key under `share.failure` in the scripts catalog. */
export type ShareFailure = 'gone' | 'cannotCopy' | 'couldNotReach' | 'failed';

/**
 * What to tell somebody whose share did not work, from what was thrown.
 *
 * A `TypeError` out of `fetch` is the station never being reached, which is a different thing to do
 * something about from the station answering and refusing.
 */
export function shareFailure(error: unknown): ShareFailure {
    const status = sdkError(error)?.status;
    if (status === 404) return 'gone';
    if (status === 503) return 'cannotCopy';
    if (status === undefined && error instanceof TypeError) return 'couldNotReach';
    return 'failed';
}

/** How the copy left: through the system's share sheet, saved as a download, or not at all because the sheet was dismissed. */
export type ShareResult = 'shared' | 'saved' | 'cancelled';

/**
 * Fetch the station's copy of a break and hand it to the browser's share sheet, or save it where
 * there is none.
 *
 * The share sheet is `navigator.share` with a file, which a phone's browser and Safari on a Mac have
 * and most desktop browsers do not. It also only exists in a secure context, and a station opened at
 * `http://<its address>:8080` on a home network is not one (the same gap `clipboard.ts` covers). So
 * the download is not a degraded path but the ordinary one on a desk, and it is what an operator
 * attaches to a message anyway.
 *
 * `NotAllowedError` falls back to the download too. The sheet needs the click to still be recent when
 * it opens, and the fetch in between can outlast that on a slow station; refusing then would make the
 * button work only on fast networks. An `AbortError` is the operator closing the sheet, which is an
 * answer and not a failure.
 *
 * Throws whatever the fetch threw, for {@link shareFailure} to word.
 */
export async function shareBreak(segmentId: string): Promise<ShareResult> {
    const copy = await fetchSegmentShare(segmentId);
    const name = shareFileName(copy.contentDisposition, copy.contentType);
    const file = new File([copy.data], name, { type: copy.contentType });

    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return 'shared';
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
            if (!(error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
        }
    }

    saveDownload(copy.data, name, copy.contentType);
    return 'saved';
}
