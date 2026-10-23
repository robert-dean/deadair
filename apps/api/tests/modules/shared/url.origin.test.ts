import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { consoleOrigins, urlOrigin } from '../../../src/modules/shared/url.origin.js';

const configOf = (values: Record<string, string>): AppConfig =>
    ({
        get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    }) as unknown as AppConfig;

describe('urlOrigin', () => {
    it('answers the origin a browser sends, whatever the address carries after it', () => {
        expect(urlOrigin('https://radio.example.com')).toBe('https://radio.example.com');
        expect(urlOrigin(' https://radio.example.com/ ')).toBe('https://radio.example.com');
        expect(urlOrigin('https://radio.example.com/console/')).toBe('https://radio.example.com');
        expect(urlOrigin('http://localhost:3002')).toBe('http://localhost:3002');
    });

    it('answers nothing for a blank value, one that does not parse, or one with no real origin', () => {
        expect(urlOrigin('')).toBeUndefined();
        expect(urlOrigin('   ')).toBeUndefined();
        expect(urlOrigin('radio.example.com')).toBeUndefined();
        expect(urlOrigin('smtp.example.com:587')).toBeUndefined();
        expect(urlOrigin(undefined)).toBeUndefined();
    });
});

describe('consoleOrigins', () => {
    // The bug this exists for: the CORS check compares exactly, so a trailing slash matched nothing.
    it('lists the console and station addresses as origins, so a trailing slash still matches', () => {
        expect(consoleOrigins(configOf({ SPA_BASE_URL: 'http://localhost:3002/', APP_BASE_URL: 'https://radio.example.com/api' }))).toEqual([
            'http://localhost:3002',
            'https://radio.example.com',
        ]);
    });

    it('lists one origin once, and leaves out a blank or unset one', () => {
        expect(consoleOrigins(configOf({ SPA_BASE_URL: 'https://radio.example.com/', APP_BASE_URL: 'https://radio.example.com' }))).toEqual([
            'https://radio.example.com',
        ]);
        expect(consoleOrigins(configOf({ APP_BASE_URL: '' }))).toEqual([]);
    });
});
