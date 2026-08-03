import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@deadair/error-codes';
import { PLUGIN_ERROR_CODES, PluginError } from '@deadair/plugin-sdk';

import { pluginHttpError } from '../../../src/modules/plugins/plugin.error.http.js';

describe('pluginHttpError', () => {
    it('maps every plugin error code to a status and an E300xx code', () => {
        for (const code of PLUGIN_ERROR_CODES) {
            const failure = pluginHttpError('spotify', new PluginError(code, 'went wrong'));

            expect(failure.statusCode).toBeGreaterThanOrEqual(400);
            expect(String(failure.details?.code)).toMatch(/^E300\d\d$/);
        }
    });

    it('answers 422 for a misconfigured plugin, so the console sends the operator to the settings form', () => {
        const failure = pluginHttpError('spotify', new PluginError('config', 'Spotify client ID is not configured'));

        expect(failure.statusCode).toBe(422);
        expect(failure.details).toMatchObject({
            code: ErrorCodes.PLUGIN_MISCONFIGURED,
            message: 'Spotify client ID is not configured',
            plugin: 'spotify',
            retryable: false,
        });
    });

    it('answers 502 with the reauthorize code for an auth failure', () => {
        const failure = pluginHttpError('spotify', new PluginError('auth', 'token expired'));

        expect(failure.statusCode).toBe(502);
        expect(failure.details?.code).toBe(ErrorCodes.PLUGIN_AUTH_REQUIRED);
    });

    it('answers 504 for a timeout and 503 when the plugin is quarantined', () => {
        expect(pluginHttpError('spotify', new PluginError('timeout', 'too slow')).statusCode).toBe(504);
        expect(pluginHttpError('spotify', new PluginError('unavailable', 'breaker open')).statusCode).toBe(503);
    });

    it('answers 429 and sets Retry-After from the upstream advice', () => {
        const failure = pluginHttpError('spotify', new PluginError('rate_limited', 'slow down', { retryAfterMs: 30_000 }));

        expect(failure.statusCode).toBe(429);
        expect(failure.headers).toEqual({ 'Retry-After': '30' });
    });

    it('rounds a sub-second Retry-After up to 1, never to 0', () => {
        const failure = pluginHttpError('spotify', new PluginError('rate_limited', 'slow down', { retryAfterMs: 200 }));

        expect(failure.headers).toEqual({ 'Retry-After': '1' });
    });

    it('omits Retry-After when the upstream gave no advice', () => {
        expect(pluginHttpError('spotify', new PluginError('rate_limited', 'slow down')).headers).toBeUndefined();
    });

    it('never sets Retry-After on a code that is not about throttling', () => {
        const failure = pluginHttpError('spotify', new PluginError('upstream', 'bad gateway', { retryAfterMs: 30_000 }));

        expect(failure.headers).toBeUndefined();
    });

    it('does not forward the upstream status onto the response, only into internal details', () => {
        // A provider 404 must not become our 404: that already means "no plugin
        // by that id" on these routes.
        const failure = pluginHttpError('spotify', new PluginError('not_found', 'no such track', { upstreamStatus: 404 }));

        expect(failure.statusCode).toBe(502);
        expect(failure.details).not.toHaveProperty('upstreamStatus');
        expect(failure.internalDetails).toMatchObject({ plugin: 'spotify', pluginErrorCode: 'not_found', upstreamStatus: 404 });
    });

    it('treats a plugin that threw a bare Error as a 500, exactly as before PluginError existed', () => {
        const failure = pluginHttpError('spotify', new Error('boom'));

        expect(failure.statusCode).toBe(500);
        expect(failure.details).toMatchObject({ code: ErrorCodes.PLUGIN_FAILED, message: 'boom' });
    });
});
