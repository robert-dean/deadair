import { describe, expect, it } from 'vitest';
import { isPluginError } from '@deadair/plugin-sdk';

import { speakFailure } from '../src/rhapsode.errors.js';

const ASKED = { engine: 'kokoro', voice: 'af_heart' };

/** A refusal shaped the way rhapsode shapes one. */
const refusal = (status: number, code: string, message = 'because'): Response =>
    new Response(JSON.stringify({ error: { code, message, retryable: false } }), {
        status,
        headers: { 'content-type': 'application/json' },
    });

describe('speakFailure', () => {
    it('reads the reason the server sent rather than guessing from the status', async () => {
        const error = await speakFailure(refusal(404, 'unknown_voice', 'no voice "af_heart"'), ASKED);

        expect(isPluginError(error)).toBe(true);
        expect(error.code).toBe('config');
        expect(error.upstreamStatus).toBe(404);
        expect(error.message).toContain('no voice "af_heart"');
        expect(error.message).toContain('engine "kokoro"');
    });

    it('keeps the words on the row for a model that was not there', async () => {
        // `unavailable` is the code the render path treats as "try this again next pass".
        for (const code of ['model_unavailable', 'oom']) {
            expect((await speakFailure(refusal(503, code), ASKED)).code).toBe('unavailable');
        }
    });

    it('maps the rest of the vocabulary', async () => {
        const expected: Record<string, string> = {
            bad_request: 'config',
            unknown_engine: 'config',
            unsupported: 'unsupported',
            overloaded: 'rate_limited',
            forbidden: 'auth',
            conflict: 'unavailable',
            internal: 'upstream',
        };

        for (const [code, mapped] of Object.entries(expected)) {
            expect((await speakFailure(refusal(400, code), ASKED)).code).toBe(mapped);
        }
    });

    it('keeps the message when the code is from a newer contract than this plugin', async () => {
        // The server's own rule, read from the other side: the envelope must not be lost over a code
        // a reader does not recognise.
        const error = await speakFailure(refusal(429, 'quota_exhausted', 'try later'), ASKED);

        expect(error.message).toContain('try later');
        expect(error.code).toBe('rate_limited');
    });

    it('falls back to the status when there is no envelope at all', async () => {
        const statuses: Record<number, string> = { 401: 'auth', 403: 'auth', 429: 'rate_limited', 503: 'unavailable', 500: 'upstream' };

        for (const [status, mapped] of Object.entries(statuses)) {
            const error = await speakFailure(new Response('<html>nginx</html>', { status: Number(status) }), ASKED);
            expect(error.code).toBe(mapped);
        }
    });

    it('ignores an envelope with nothing said in it', async () => {
        const error = await speakFailure(new Response(JSON.stringify({ error: { code: 'internal' } }), { status: 503 }), ASKED);

        // No message means nothing to report, so the status decides and the code is not trusted over
        // it: a body that shape is a proxy imitating an envelope, not the server.
        expect(error.code).toBe('unavailable');
    });

    it('names the variant when one was asked for', async () => {
        const error = await speakFailure(refusal(422, 'unsupported'), { engine: 'chatterbox', voice: 'gravel', variant: 'turbo' });

        expect(error.message).toContain('variant "turbo"');
    });

    it('lets the body go, since nobody else is going to read it', async () => {
        const response = refusal(400, 'bad_request');

        await speakFailure(response, ASKED);

        expect(response.bodyUsed).toBe(true);
    });
});
