// The failure this file exists for: Subsonic reports a wrong password, or an id
// that does not exist, as an HTTP 200 whose body says `status: "failed"`. A
// client that only checked `response.ok` would read both as a successful call
// that returned nothing.

import { describe, expect, it } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';

import { SubsonicAuth } from '../src/navidrome.auth.js';
import { SubsonicClient, SubsonicRequestError, isNotFound } from '../src/navidrome.client.js';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

const BASE_URL = 'http://navidrome.test:4533';

function build(baseUrl = BASE_URL): { host: FakePluginHost; client: SubsonicClient } {
    const host = createFakePluginHost();
    return { host, client: new SubsonicClient(host, baseUrl, new SubsonicAuth('station', 'hunter2')) };
}

/** A successful Subsonic envelope carrying `payload`. */
const ok = (payload: Record<string, unknown> = {}) => ({
    body: JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } }),
});

/** A failed one. Note the HTTP status stays 200, which is the whole point. */
const failed = (code: number, message: string) => ({
    body: JSON.stringify({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } } }),
});

describe('SubsonicClient.url', () => {
    it('builds a /rest URL carrying credentials and the call parameters', () => {
        const url = new URL(build().client.url('getSong.view', { id: 'song-1' }));

        expect(url.origin + url.pathname).toBe(`${BASE_URL}/rest/getSong.view`);
        expect(url.searchParams.get('id')).toBe('song-1');
        expect(url.searchParams.get('u')).toBe('station');
        expect(url.searchParams.get('c')).toBe('deadair');
        expect(url.searchParams.get('f')).toBe('json');
        expect(url.searchParams.get('t')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('drops parameters the caller left undefined rather than sending them empty', () => {
        // Subsonic reads an empty `maxBitRate` as zero, not as absent, so a blank
        // setting has to disappear from the URL entirely.
        const url = new URL(build().client.url('stream.view', { id: 'song-1', maxBitRate: undefined }));

        expect(url.searchParams.has('maxBitRate')).toBe(false);
    });

    it('tolerates a server URL with a trailing slash', () => {
        expect(build('http://navidrome.test:4533/').client.url('ping.view')).toContain('http://navidrome.test:4533/rest/ping.view?');
    });

    it('mints one identical URL per image when asked for the stable form', () => {
        const { client } = build();
        expect(client.url('getCoverArt.view', { id: 'art-1' }, true)).toBe(client.url('getCoverArt.view', { id: 'art-1' }, true));
    });
});

describe('SubsonicClient.get', () => {
    it('unwraps the envelope', async () => {
        const { host, client } = build();
        host.queueResponse(ok({ song: { id: 'song-1', title: 'A Track' } }));

        await expect(client.get<{ song?: { title?: string } }>('getSong.view', { id: 'song-1' })).resolves.toMatchObject({
            song: { title: 'A Track' },
        });
    });

    it('turns wrong credentials into a config error the operator can act on', async () => {
        const { host, client } = build();
        host.queueResponse(failed(40, 'Wrong username or password'));

        await expect(client.get('ping.view')).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('Wrong username') });
    });

    it('leaves "no such thing" recognisable, because a miss is data', async () => {
        const { host, client } = build();
        host.queueResponse(failed(70, 'Song not found'));

        const error = await client.get('getSong.view', { id: 'gone' }).catch((thrown: unknown) => thrown);

        expect(isNotFound(error)).toBe(true);
        expect((error as SubsonicRequestError).subsonicCode).toBe(70);
        // The host's own vocabulary is separate and still set, which is why the
        // numeric code does not live on `code`.
        expect((error as SubsonicRequestError).code).toBe('not_found');
    });

    it('refuses a 200 that is not a Subsonic response at all', async () => {
        // A reverse proxy's login page, or a `baseUrl` pointing at something else
        // entirely. Both are the operator's to fix, so both say so.
        const { host, client } = build();
        host.queueResponse({ body: '{"hello":"world"}' });

        await expect(client.get('ping.view')).rejects.toMatchObject({ code: 'upstream', message: expect.stringContaining('not a Subsonic') });
    });

    it('maps an HTTP failure by its status', async () => {
        const { host, client } = build();
        host.queueResponse({ status: 502, statusText: 'Bad Gateway', body: '' });

        await expect(client.get('ping.view')).rejects.toMatchObject({ code: 'unavailable', upstreamStatus: 502 });
    });

    it('throws the host vocabulary rather than a bare Error, whichever layer failed', async () => {
        // Everything the plugin throws is flattened to `internal` by the invoker
        // unless it is a PluginError, and an operator reading `internal` learns
        // nothing about their own typo.
        const { host, client } = build();
        host.queueResponse(failed(41, 'Token authentication not supported'));

        await expect(client.get('ping.view')).rejects.toBeInstanceOf(PluginError);
    });
});
