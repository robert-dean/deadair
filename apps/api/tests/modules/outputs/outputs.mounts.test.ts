import { describe, expect, it } from 'vitest';

import { MOUNT_CONTENT_TYPES, acceptsType, mountUrl, mountsFor, stationMounts } from '../../../src/modules/outputs/outputs.mounts.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('stationMounts', () => {
    it('is MP3 alone on a station that switched nothing else on', () => {
        expect(stationMounts(settingsConfig().config)).toEqual([{ format: 'mp3', path: '/live.mp3' }]);
    });

    it('lists every mount switched on, MP3 first and HLS last, reading each switch as a string', () => {
        const { config } = settingsConfig({ 'stream.aacEnabled': 'true', 'stream.opusEnabled': 'false', 'stream.hlsEnabled': 'on' });

        expect(stationMounts(config).map(mount => mount.format)).toEqual(['mp3', 'aac', 'hls']);
    });
});

describe('acceptsType', () => {
    it('matches the same type', () => {
        expect(acceptsType(['audio/mpeg'], 'audio/mpeg')).toBe(true);
    });

    it('takes a bare type as covering every codec in it', () => {
        expect(acceptsType(['audio/ogg'], MOUNT_CONTENT_TYPES.opus)).toBe(true);
        expect(acceptsType(['audio/ogg'], MOUNT_CONTENT_TYPES.flac)).toBe(true);
    });

    it('does not let one codec stand for another', () => {
        expect(acceptsType(['audio/ogg; codecs=opus'], MOUNT_CONTENT_TYPES.flac)).toBe(false);
    });

    it('ignores case', () => {
        expect(acceptsType(['Audio/MPEG'], 'audio/mpeg')).toBe(true);
    });
});

describe('mountsFor', () => {
    it("offers a speaker only the station's mounts it plays, in the station's order", () => {
        const mounts = stationMounts(settingsConfig({ 'stream.aacEnabled': 'true', 'stream.flacEnabled': 'true' }).config);

        expect(mountsFor(['audio/aac', 'audio/mpeg'], mounts).map(mount => mount.format)).toEqual(['mp3', 'aac']);
    });
});

describe('mountUrl', () => {
    it("joins the station's public address and the mount", () => {
        expect(mountUrl(settingsConfig({ 'stream.publicUrl': 'https://radio.example.com/' }).config, '/live.mp3')).toBe(
            'https://radio.example.com/live.mp3',
        );
    });

    it('falls back to the deployed address when no public one is set', () => {
        expect(mountUrl(settingsConfig({ APP_BASE_URL: 'http://192.168.1.10:8080' }).config, '/live.mp3')).toBe('http://192.168.1.10:8080/live.mp3');
    });

    it('answers nothing when there is no address at all', () => {
        expect(mountUrl(settingsConfig().config, '/live.mp3')).toBeUndefined();
    });

    it.each(['http://localhost:8080', 'http://127.0.0.1', 'http://radio.localhost'])(
        'refuses %s, which is the speaker itself from where it stands',
        origin => {
            expect(mountUrl(settingsConfig({ 'stream.publicUrl': origin }).config, '/live.mp3')).toBeUndefined();
        },
    );
});
