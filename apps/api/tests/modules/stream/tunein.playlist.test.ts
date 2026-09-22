// The tune-in files are read by players nobody here can watch fail: a car receiver or a hardware
// radio given a file it cannot use simply plays nothing. So the cases are the shape each format
// needs, and the one mistake the design warns about, which is naming an address only the stack can
// reach.

import { describe, expect, it } from 'vitest';

import { StreamService } from '../../../src/modules/stream/stream.service.js';
import { STREAM_KEYS, streamMounts, resolveMountSettings } from '../../../src/modules/stream/stream.settings.js';
import { tuneInM3u, tuneInPls } from '../../../src/modules/stream/tunein.playlist.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ORIGIN = 'https://radio.example.test';

/** The mounts a station with these settings publishes, through the one resolver that decides them. */
const mountsWith = (settings: Record<string, string> = {}) => streamMounts(resolveMountSettings(settingsConfig(settings).config));

/** Only `config` is reached on this path. */
const serviceWith = (settings: Record<string, string>) =>
    new StreamService(
        undefined as never,
        undefined as never,
        settingsConfig(settings).config,
        undefined as never,
        undefined as never,
        undefined as never,
    );

describe('tuneInPls', () => {
    it('lists every mount as an absolute address on the public origin, MP3 first, in PLS version 2', () => {
        const pls = tuneInPls(ORIGIN, 'Deadair', mountsWith({ [STREAM_KEYS.opusEnabled]: 'true' }));

        expect(pls).toBe(
            [
                '[playlist]',
                `File1=${ORIGIN}/live.mp3`,
                'Title1=Deadair (MP3 128 kbps)',
                'Length1=-1',
                `File2=${ORIGIN}/live.opus`,
                'Title2=Deadair (OPUS 160 kbps)',
                'Length2=-1',
                'NumberOfEntries=2',
                'Version=2',
                '',
            ].join('\n'),
        );
    });

    it('leaves the HLS stream out, since the players that read PLS cannot follow it', () => {
        expect(tuneInPls(ORIGIN, 'Deadair', mountsWith({ [STREAM_KEYS.hlsEnabled]: 'true' }))).not.toContain('m3u8');
    });

    it('keeps a station name with a line break in it on one line, where a player would end the entry', () => {
        expect(tuneInPls(ORIGIN, 'Dead\nair', mountsWith())).toContain('Title1=Dead air (MP3 128 kbps)\n');
    });
});

describe('tuneInM3u', () => {
    it('lists every mount, then the HLS stream when it is on', () => {
        const m3u = tuneInM3u(ORIGIN, 'Deadair', mountsWith({ [STREAM_KEYS.flacEnabled]: 'true' }), true);

        expect(m3u).toBe(
            [
                '#EXTM3U',
                '#EXTINF:-1,Deadair (MP3 128 kbps)',
                `${ORIGIN}/live.mp3`,
                '#EXTINF:-1,Deadair (FLAC)',
                `${ORIGIN}/live.flac`,
                '#EXTINF:-1,Deadair (HLS)',
                `${ORIGIN}/live.m3u8`,
                '',
            ].join('\n'),
        );
    });

    it('names no HLS stream that is switched off', () => {
        expect(tuneInM3u(ORIGIN, 'Deadair', mountsWith(), false)).not.toContain('m3u8');
    });
});

describe('StreamService tune-in files', () => {
    it('builds both from the public address, never from the internal Icecast host', async () => {
        const settings = { [STREAM_KEYS.publicUrl]: `${ORIGIN}/`, [STREAM_KEYS.icecastHost]: 'icecast', [STREAM_KEYS.title]: 'Night Shift' };

        const pls = await serviceWith(settings).getTuneInPls();
        const m3u = await serviceWith(settings).getTuneInM3u();

        for (const file of [pls, m3u]) {
            expect(file).toContain(`${ORIGIN}/live.mp3`);
            expect(file).toContain('Night Shift');
            expect(file).not.toContain('icecast');
        }
    });

    it('answers 404 naming the setting when the station has no public address at all', async () => {
        await expect(serviceWith({}).getTuneInPls()).rejects.toMatchObject({ statusCode: 404 });
        await expect(serviceWith({}).getTuneInM3u()).rejects.toMatchObject({ statusCode: 404 });
    });
});
