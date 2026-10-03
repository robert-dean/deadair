import { describe, expect, it } from 'vitest';

import { speakFailure } from '../src/elevenlabs.errors.js';

const ATTEMPT = { voice: 'v1', model: 'eleven_v4' };

const refused = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('speakFailure', () => {
    it.each([
        ['invalid_api_key', 401, 'auth'],
        ['quota_exceeded', 401, 'forbidden'],
        ['voice_not_found', 400, 'not_found'],
        ['voice_not_allowed', 403, 'forbidden'],
        ['too_many_concurrent_requests', 429, 'rate_limited'],
        ['system_busy', 429, 'rate_limited'],
    ])('maps the reason %s to %s', async (reason, status, code) => {
        const error = await speakFailure(refused(status, { detail: { status: reason, message: 'said so' } }), ATTEMPT);

        expect(error.code).toBe(code);
        expect(error.upstreamStatus).toBe(status);
        expect(error.message).toBe(`elevenlabs answered HTTP ${status} for voice "v1" on eleven_v4: said so`);
    });

    it.each([
        [401, 'auth'],
        [403, 'auth'],
        [404, 'not_found'],
        [429, 'rate_limited'],
        [503, 'unavailable'],
        [500, 'upstream'],
    ])('falls back to the status %i when there is no reason', async (status, code) => {
        const error = await speakFailure(refused(status, 'Bad Gateway, from a proxy'), ATTEMPT);

        expect(error.code).toBe(code);
        expect(error.message).toBe(`elevenlabs answered HTTP ${status} for voice "v1" on eleven_v4`);
    });

    it('keeps the message of a reason it does not know, and classifies by status', async () => {
        const error = await speakFailure(refused(400, { detail: { status: 'something_new', message: 'a new thing' } }), ATTEMPT);

        expect(error.code).toBe('upstream');
        expect(error.message).toContain('a new thing');
    });

    it("reads the validator's array of complaints", async () => {
        const error = await speakFailure(refused(422, { detail: [{ loc: ['body', 'text'], msg: 'field required' }] }), ATTEMPT);

        expect(error.code).toBe('upstream');
        expect(error.message).toContain('field required');
    });
});
