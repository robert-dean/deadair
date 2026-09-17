// The case this file exists for is the one `errorText` cannot answer: `fetch` rejects with a bare
// `TypeError: fetch failed` whatever went wrong, so the message alone reads identically for "nothing
// is listening on that port", "that name does not resolve" and "it is listening, on TLS". The reason
// is on `cause`, and for a plugin's stored `lastError` or a record's `last_error` the stored string
// is all anybody ever gets.

import { describe, expect, it } from 'vitest';

import { causeText, errorText, serverkitErrorText } from '../../../src/modules/shared/error.text.js';

/** A rejection shaped the way undici shapes one: the useful half is a level down. */
const fetchFailure = (code: string, message: string): Error => new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });

describe('causeText', () => {
    it('names the reason a fetch failed, which the message alone never does', () => {
        const refused = fetchFailure('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:8880');

        // What an operator is actually being told: the speech server is not running on that port.
        expect(causeText(refused)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:8880 (ECONNREFUSED)');
        // And what they used to be told instead, from the same error.
        expect(errorText(refused)).toBe('fetch failed');
    });

    it('keeps a cause that carries no code, because the sentence is still the diagnosis', () => {
        expect(causeText(new Error('write failed', { cause: new Error('socket hang up') }))).toBe('write failed: socket hang up');
    });

    it('answers the message alone when nothing caused it', () => {
        expect(causeText(new Error('plain'))).toBe('plain');
    });

    it('stops three deep rather than walking a chain somebody nested', () => {
        const deep = new Error('a', { cause: new Error('b', { cause: new Error('c', { cause: new Error('d', { cause: new Error('e') }) }) }) });

        expect(causeText(deep)).toBe('a: b: c: d');
    });

    it('stringifies a thrown non-Error, as its two siblings do', () => {
        expect(causeText('nope')).toBe('nope');
        expect(errorText('nope')).toBe('nope');
        expect(serverkitErrorText('nope')).toBe('nope');
    });
});
