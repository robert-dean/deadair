// Who a passkey is bound to. The whole safety of reading it from the request rests on one rule,
// pinned here: an origin is answered only when it is an address the station is deployed at, and
// localhost only in development. Anything else is refused rather than echoed back.

import { afterEach, describe, expect, it } from 'vitest';
import type { ServerKitContext } from '@maroonedsoftware/koa';
import { ErrorCodes } from '@deadair/error-codes';

import { PasskeyRelyingParty } from '../../../src/modules/authentication/passkey.relying.party.js';
import { settingsConfig } from '../../utils/settings.config.js';

const nodeEnv = process.env.NODE_ENV;
afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
});

const relyingParty = (origin: string | undefined, settings: Record<string, string> = {}) =>
    new PasskeyRelyingParty(
        { get: (name: string) => (name === 'origin' ? (origin ?? '') : '') } as unknown as ServerKitContext,
        settingsConfig(settings).config,
    );

const refusal = (party: PasskeyRelyingParty) => {
    try {
        party.resolve();
    } catch (error) {
        return (error as { details?: { code?: string } }).details?.code;
    }
    return undefined;
};

describe('PasskeyRelyingParty', () => {
    it('binds a passkey to the deployed address, named after the station', () => {
        const party = relyingParty('https://radio.example', { SPA_BASE_URL: 'https://radio.example/', 'stream.title': 'Night Owl FM' });

        expect(party.resolve()).toEqual({ rpId: 'radio.example', rpOrigin: 'https://radio.example', rpName: 'Night Owl FM' });
    });

    it('accepts the public URL the operator set as well as the deployed one', () => {
        const party = relyingParty('https://listen.example', { SPA_BASE_URL: 'https://radio.example', 'stream.publicUrl': 'https://listen.example' });

        expect(party.resolve().rpId).toBe('listen.example');
    });

    it('refuses a page on any other address, which is the attack passkeys exist to stop', () => {
        expect(refusal(relyingParty('https://radio.example.evil.test', { SPA_BASE_URL: 'https://radio.example' }))).toBe(
            ErrorCodes.PASSKEY_ORIGIN_REFUSED,
        );
    });

    it('refuses the right host on the wrong scheme or port', () => {
        expect(refusal(relyingParty('http://radio.example', { SPA_BASE_URL: 'https://radio.example' }))).toBe(ErrorCodes.PASSKEY_ORIGIN_REFUSED);
        expect(refusal(relyingParty('https://radio.example:8443', { SPA_BASE_URL: 'https://radio.example' }))).toBe(
            ErrorCodes.PASSKEY_ORIGIN_REFUSED,
        );
    });

    it('refuses a request with no origin, or one that is not a URL', () => {
        expect(refusal(relyingParty(undefined, { SPA_BASE_URL: 'https://radio.example' }))).toBe(ErrorCodes.PASSKEY_ORIGIN_REFUSED);
        expect(refusal(relyingParty('not a url', { SPA_BASE_URL: 'https://radio.example' }))).toBe(ErrorCodes.PASSKEY_ORIGIN_REFUSED);
    });

    it('allows the developer console on localhost only in development', () => {
        process.env.NODE_ENV = 'development';
        expect(relyingParty('http://localhost:3002').resolve()).toMatchObject({ rpId: 'localhost', rpOrigin: 'http://localhost:3002' });

        process.env.NODE_ENV = 'production';
        expect(refusal(relyingParty('http://localhost:3002'))).toBe(ErrorCodes.PASSKEY_ORIGIN_REFUSED);
    });

    it('falls back to the software name when the station has none', () => {
        const party = relyingParty('https://radio.example', { SPA_BASE_URL: 'https://radio.example', 'stream.title': '   ' });

        expect(party.resolve().rpName).not.toBe('');
    });
});
