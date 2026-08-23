// The session key is a PEM, which is several lines, and almost nowhere an operator sets it holds
// more than one. Getting this wrong produces a station that boots, reports itself healthy, and
// then cannot sign anybody in — so the shapes a text field turns a key into are worth pinning.

import { describe, expect, it } from 'vitest';

import { readSessionKey } from '../../../src/modules/authentication/session.key.js';

const PEM = ['-----BEGIN PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ', 'abc123', '-----END PRIVATE KEY-----'].join('\n');

describe('readSessionKey', () => {
    it('takes a PEM as it comes out of openssl', () => {
        expect(readSessionKey(PEM)).toBe(PEM);
    });

    it('takes a PEM whose line breaks were written as two characters', () => {
        // What a compose `.env` carries, and what anyone pasting into a single-line field ends up
        // with when they are being careful.
        expect(readSessionKey(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
    });

    it('takes a PEM that was base64-ed to survive the field it went through', () => {
        expect(readSessionKey(Buffer.from(PEM, 'utf8').toString('base64'))).toBe(PEM);
    });

    it('ignores the whitespace a copy and paste leaves behind', () => {
        expect(readSessionKey(`\n  ${PEM}  \n`)).toBe(PEM);
    });

    it('answers empty for a key nobody set, so the caller can say which variable is missing', () => {
        expect(readSessionKey('')).toBe('');
        expect(readSessionKey('   ')).toBe('');
    });

    // Nothing here validates a key. What matters is that a value which is not one is handed back
    // as it arrived, to fail where it would have failed anyway — rather than being replaced by
    // whichever bytes it happened to decode to, which is a different and much stranger failure.
    it('hands back anything that is not a key unchanged', () => {
        expect(readSessionKey('not a key')).toBe('not a key');
        // Valid base64 of something that is not a PEM.
        expect(readSessionKey(Buffer.from('still not a key', 'utf8').toString('base64'))).toBe(
            Buffer.from('still not a key', 'utf8').toString('base64'),
        );
    });
});
