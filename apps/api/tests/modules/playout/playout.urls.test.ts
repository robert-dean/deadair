// The air-confirmation URL is written into radio.env and called by Liquidsoap with
// no one listening for the result: `http.post` inside the streaming script is
// fire-and-forget, so a wrong URL is a 404 nobody ever sees and a now-playing that
// silently lags a whole item behind the mount.
//
// The specific trap this pins: the API mounts its routers at the ROOT. The /api the
// SPA uses is added and stripped by Vite's dev proxy, so a base carrying that prefix
// 404s for every caller that is not a browser.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { DEFAULT_PLAYOUT_BASE_URL, playoutAiredUrl, resolvePlayoutBaseUrl } from '../../../src/modules/playout/playout.urls.js';

const configWith = (values: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback: string) => values[key] ?? fallback }) as unknown as AppConfig;

describe('resolvePlayoutBaseUrl', () => {
    it('defaults to the host-run app, with no /api prefix', () => {
        expect(resolvePlayoutBaseUrl(configWith())).toBe('http://host.docker.internal:3333/playout');
        expect(DEFAULT_PLAYOUT_BASE_URL).not.toContain('/api');
    });

    it('takes the configured override', () => {
        expect(resolvePlayoutBaseUrl(configWith({ PLAYOUT_BASE_URL: 'http://app:3333/playout' }))).toBe('http://app:3333/playout');
    });

    it('trims a trailing slash so the joined path has exactly one', () => {
        expect(playoutAiredUrl(resolvePlayoutBaseUrl(configWith({ PLAYOUT_BASE_URL: 'http://app:3333/playout//' })))).toBe(
            'http://app:3333/playout/aired',
        );
    });
});

describe('playoutAiredUrl', () => {
    it('names the route the playout contract actually serves', () => {
        expect(playoutAiredUrl(DEFAULT_PLAYOUT_BASE_URL)).toBe('http://host.docker.internal:3333/playout/aired');
    });
});
