// Switching HLS off has to stop it being SERVED, not just stop it being produced. Liquidsoap
// stops writing the moment the setting changes and nothing deletes what it already wrote, so
// without this the route goes on answering 200 with a frozen playlist for as long as the files
// sit there — measured on a live station, where a client stayed attached to a stream that had
// stopped advancing, counted as a listener, holding an audience-gated station on air.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { StreamService } from '../../../src/modules/stream/stream.service.js';

/**
 * A config layer that answers with STRINGS, which is what every real one does.
 *
 * `stream.hlsEnabled` is read through `settingIsOn` for exactly this reason, so the off case is
 * tested with the string a settings row actually holds rather than with a boolean, which would
 * pass whatever the code did with it.
 */
const configWith = (hlsEnabled: string | undefined, dir: string): AppConfig =>
    ({
        get: (key: string, fallback: unknown) => {
            if (key === 'STREAM_HLS_DIR') return dir;
            if (key === 'stream.hlsEnabled') return hlsEnabled ?? fallback;
            return fallback;
        },
    }) as AppConfig;

/** Only `config` is reached in this path; the rest of the service's collaborators are not touched. */
const serviceWith = (config: AppConfig) =>
    new StreamService(undefined as never, undefined as never, config, undefined as never, undefined as never, undefined as never);

describe('StreamService.getHlsPlaylist', () => {
    let dir: string;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'deadair-hls-'));
        await writeFile(join(dir, 'mp3.m3u8'), '#EXTM3U\n');
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('serves the playlist while HLS is on', async () => {
        const answer = await serviceWith(configWith('true', dir)).getHlsPlaylist('mp3.m3u8');

        expect(answer.body.toString()).toContain('#EXTM3U');
        // A live playlist is worthless a moment later and must not be held anywhere.
        expect(answer.headers.cacheControl).toContain('no-store');
    });

    it('refuses once HLS is switched off, even though the file is still on disk', async () => {
        for (const off of ['false', 'off', '0']) {
            await expect(serviceWith(configWith(off, dir)).getHlsPlaylist('mp3.m3u8')).rejects.toMatchObject({
                // 404 rather than 409 or 503: a caller learns nothing from being told the
                // difference, and a player asking for something that is not there wants the
                // same answer either way.
                statusCode: 404,
            });
        }
    });

    it('refuses when nothing has been switched on at all, since the default is off', async () => {
        await expect(serviceWith(configWith(undefined, dir)).getHlsPlaylist('mp3.m3u8')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('still refuses a name that would leave the directory while HLS is on', async () => {
        await expect(serviceWith(configWith('true', dir)).getHlsPlaylist('../secrets.m3u8')).rejects.toMatchObject({ statusCode: 404 });
    });
});
