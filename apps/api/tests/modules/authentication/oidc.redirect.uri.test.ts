// Where Google sends the browser back to. `APP_BASE_URL` is the station's origin, and the only thing
// every edge hands the API is what arrives under `/api/`, with the prefix stripped. The redirect was
// built without that prefix, so Google's return fell through to the console's not-found page in the
// one-container image. Every layer of `AppConfig` holds strings, so the double hands over strings.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { oidcRedirectUri } from '../../../src/modules/authentication/authentication.module.js';
import { AuthenticationRouter } from '../../../src/routes/authentication.router.js';

const configWith = (appBaseUrl: string | undefined) =>
    ({
        get: (key: string, fallback: unknown) => (key === 'APP_BASE_URL' && appBaseUrl !== undefined ? appBaseUrl : fallback),
    }) as unknown as AppConfig;

/** What the edge does to a path before the API sees it: `proxy_pass http://app:3000/;` under `location ^~ /api/`. */
const pastTheEdge = (pathname: string): string | undefined => (pathname.startsWith('/api/') ? pathname.slice('/api'.length) : undefined);

describe('the OIDC redirect URI', () => {
    it('is under /api on the station origin', () => {
        expect(oidcRedirectUri(configWith('https://radio.example.com')).href).toBe('https://radio.example.com/api/auth/login/oidc/callback');
    });

    it('lands on the route the API serves once the edge strips /api', () => {
        const pathname = pastTheEdge(oidcRedirectUri(configWith('https://radio.example.com')).pathname);

        expect(pathname).toBeDefined();
        expect(AuthenticationRouter.match(pathname!, 'GET').route).toBe(true);
    });

    it('does not double the slash when the origin was written with a trailing one', () => {
        expect(oidcRedirectUri(configWith('https://radio.example.com/')).href).toBe('https://radio.example.com/api/auth/login/oidc/callback');
    });
});
