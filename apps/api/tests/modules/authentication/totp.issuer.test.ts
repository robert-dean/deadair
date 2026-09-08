// The label an authenticator app shows beside the code is the station's own name. Every layer of
// `AppConfig` holds strings, so the double here hands over strings and nothing else.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { totpIssuer } from '../../../src/modules/authentication/authentication.module.js';

const configWith = (title: string | undefined) =>
    ({
        get: (key: string, fallback: unknown) => (key === 'stream.title' && title !== undefined ? title : fallback),
    }) as unknown as AppConfig;

describe('the TOTP issuer', () => {
    it('is the station name', () => {
        expect(totpIssuer(configWith('Late Night Static'))).toBe('Late Night Static');
    });

    it('falls back to the default when the name was never set', () => {
        expect(totpIssuer(configWith(undefined))).toBe('Deadair');
    });

    it('falls back when the name was cleared, so the code is never unlabelled on the phone', () => {
        expect(totpIssuer(configWith('   '))).toBe('Deadair');
    });
});
