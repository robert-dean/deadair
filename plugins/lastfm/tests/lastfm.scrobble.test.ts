// The two pieces of this plugin whose failures are invisible from a live run.
//
// A wrong signature produces exactly one symptom — "invalid signature" — whatever caused it, so the
// rules are pinned here rather than discovered against the service. And `retryable` decides whether
// a play is retried forever or thrown away, neither of which shows up for a day.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { sign } from '../src/lastfm.client.js';
import { readScrobbleResult } from '../src/lastfm.plugin.js';
import type { LastfmScrobbleResponse } from '../src/lastfm.types.js';

const SECRET = 'shared-secret';

describe('signing', () => {
    it('sorts by name and concatenates name then value, with the secret last', () => {
        const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex');

        expect(sign({ b: '2', a: '1' }, SECRET)).toBe(md5(`a1b2${SECRET}`));
    });

    it('EXCLUDES format, which is the mistake that costs an afternoon', () => {
        // Signing `format=json` produces a signature that verifies nowhere, and the service's only
        // feedback is "invalid signature" — indistinguishable from having the wrong secret.
        expect(sign({ a: '1', format: 'json' }, SECRET)).toBe(sign({ a: '1' }, SECRET));
    });

    it('excludes any api_sig that is already there, so signing twice is stable', () => {
        const once = sign({ a: '1' }, SECRET);
        expect(sign({ a: '1', api_sig: once }, SECRET)).toBe(once);
    });

    it('signs the indexed batch parameters, which is what stops one being swapped', () => {
        const batch = { 'artist[0]': 'Portishead', 'track[0]': 'Roads', sk: 'session' };
        const tampered = { ...batch, 'track[0]': 'Glory Box' };

        expect(sign(batch, SECRET)).not.toBe(sign(tampered, SECRET));
    });

    it('is sensitive to the secret, which is the whole point', () => {
        expect(sign({ a: '1' }, SECRET)).not.toBe(sign({ a: '1' }, 'other-secret'));
    });
});

describe('reading what became of a batch', () => {
    const ignored = (code: number, text = 'nope') => ({ ignoredMessage: { code: String(code), '#text': text } });
    const accepted = { ignoredMessage: { code: '0', '#text': '' } };

    it('counts a clean batch as wholly accepted', () => {
        const response: LastfmScrobbleResponse = { scrobbles: { scrobble: [accepted, accepted] } };

        expect(readScrobbleResult(response, 2)).toEqual({ accepted: 2, rejected: [] });
    });

    it.each([
        [1, 'an artist the service will not accept'],
        [2, 'a track the service will not accept'],
        [3, 'a timestamp too old to take'],
    ])('marks ignore code %i as permanent, since %s only gets more so', code => {
        const response: LastfmScrobbleResponse = { scrobbles: { scrobble: [ignored(code)] } };
        const result = readScrobbleResult(response, 1);

        expect(result.rejected).toEqual([{ index: 0, reason: 'nope', retryable: false }]);
        expect(result.accepted).toBe(0);
    });

    it.each([
        [4, 'a clock skew resolves'],
        [5, 'a daily limit resets'],
    ])('marks ignore code %i as retryable, because %s', code => {
        const response: LastfmScrobbleResponse = { scrobbles: { scrobble: [ignored(code)] } };

        expect(readScrobbleResult(response, 1).rejected[0]?.retryable).toBe(true);
    });

    it('treats an unfamiliar code as retryable, which is the safer way to be wrong', () => {
        // Dropping a play we did not understand loses a listen; retrying one costs a request.
        expect(readScrobbleResult({ scrobbles: { scrobble: [ignored(99)] } }, 1).rejected[0]?.retryable).toBe(true);
    });

    it('reports the index within the batch, which is how the host finds the row', () => {
        const response: LastfmScrobbleResponse = { scrobbles: { scrobble: [accepted, ignored(3), accepted] } };

        expect(readScrobbleResult(response, 3).rejected).toEqual([{ index: 1, reason: 'nope', retryable: false }]);
    });

    it('falls back to its own sentence when the service gave no reason', () => {
        const response: LastfmScrobbleResponse = { scrobbles: { scrobble: [{ ignoredMessage: { code: '3' } }] } };

        expect(readScrobbleResult(response, 1).rejected[0]?.reason).toMatch(/code 3/);
    });

    it('takes a lone object, which is how this API sends a one-play batch', () => {
        expect(readScrobbleResult({ scrobbles: { scrobble: accepted } }, 1)).toEqual({ accepted: 1, rejected: [] });
    });

    it('counts a response that said nothing at all as accepted', () => {
        // The host treats anything neither counted nor rejected as accepted, and this keeps that
        // arithmetic true: a duplicate beats a lost listen.
        expect(readScrobbleResult({}, 5)).toEqual({ accepted: 5, rejected: [] });
    });
});
