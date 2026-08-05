import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@deadair/error-codes';
import { PLUGIN_ERROR_CODES, PluginError } from '@deadair/plugin-sdk';

import { pluginHttpError } from '../../../src/modules/plugins/plugin.error.http.js';

describe('pluginHttpError', () => {
    it('maps every plugin error code to a status and an E300xx code', () => {
        for (const code of PLUGIN_ERROR_CODES) {
            const failure = pluginHttpError('spotify', new PluginError('went wrong').withCode(code));

            expect(failure.statusCode).toBeGreaterThanOrEqual(400);
            expect(String(failure.details?.code)).toMatch(/^E300\d\d$/);
        }
    });

    it('answers 422 for a misconfigured plugin, so the console sends the operator to the settings form', () => {
        const failure = pluginHttpError('spotify', new PluginError('Spotify client ID is not configured').withCode('config'));

        expect(failure.statusCode).toBe(422);
        expect(failure.details).toMatchObject({
            code: ErrorCodes.PLUGIN_MISCONFIGURED,
            message: 'Spotify client ID is not configured',
            plugin: 'spotify',
            retryable: false,
        });
    });

    it('answers 502 with the reauthorize code for an auth failure', () => {
        const failure = pluginHttpError('spotify', new PluginError('token expired').withCode('auth'));

        expect(failure.statusCode).toBe(502);
        expect(failure.details?.code).toBe(ErrorCodes.PLUGIN_AUTH_REQUIRED);
    });

    it('answers 504 for a timeout and 503 when the plugin is quarantined', () => {
        expect(pluginHttpError('spotify', new PluginError('too slow').withCode('timeout')).statusCode).toBe(504);
        expect(pluginHttpError('spotify', new PluginError('breaker open').withCode('unavailable')).statusCode).toBe(503);
    });

    it('answers 429 and sets Retry-After from the upstream advice', () => {
        const failure = pluginHttpError('spotify', new PluginError('slow down').withCode('rate_limited').withRetry(30_000));

        expect(failure.statusCode).toBe(429);
        expect(failure.headers).toEqual({ 'Retry-After': '30' });
    });

    it('rounds a sub-second Retry-After up to 1, never to 0', () => {
        const failure = pluginHttpError('spotify', new PluginError('slow down').withCode('rate_limited').withRetry(200));

        expect(failure.headers).toEqual({ 'Retry-After': '1' });
    });

    it('omits Retry-After when the upstream gave no advice', () => {
        expect(pluginHttpError('spotify', new PluginError('slow down').withCode('rate_limited')).headers).toBeUndefined();
    });

    it('never sets Retry-After on a code that is not about throttling', () => {
        const failure = pluginHttpError('spotify', new PluginError('bad gateway').withCode('upstream').withRetry(30_000));

        expect(failure.headers).toBeUndefined();
    });

    it('does not forward the upstream status onto the response, only into internal details', () => {
        // A provider 404 must not become our 404: that already means "no plugin
        // by that id" on these routes.
        const failure = pluginHttpError('spotify', new PluginError('no such track').withCode('not_found').withUpstreamStatus(404));

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
