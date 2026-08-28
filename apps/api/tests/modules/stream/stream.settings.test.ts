// Two behaviours matter here and neither is visible from a running station.
//
// `ensureStreamSecrets` must never overwrite a secret the operator chose: doing so
// would rotate the Icecast password out from under a connected source at boot.
// `resolveStreamSettings` must not fail the whole read because one value will not
// decrypt, because that read is what renders the config for both containers.

import { randomBytes } from 'node:crypto';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { describe, expect, it } from 'vitest';

import {
    ensureStreamSecrets,
    mountPathFor,
    resolveStreamSettings,
    STREAM_KEYS,
    STREAM_SECRET_KEYS,
    streamMounts,
} from '../../../src/modules/stream/stream.settings.js';
import type { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

const encryption = new EncryptionProvider(randomBytes(32));

/** The three repository methods these functions use, over a plain map. */
function fakeRepository(initial: Record<string, string> = {}): SettingsRepository & { store: Map<string, string> } {
    const store = new Map(Object.entries(initial));
    return {
        store,
        get: async (key: string) => store.get(key),
        getMany: async (keys: string[]) => {
            const values = new Map<string, string>();
            for (const key of keys) {
                const value = store.get(key);
                if (value !== undefined) values.set(key, value);
            }
            return values;
        },
        all: async () => new Map(store),
        set: async (key: string, value: string | null) => {
            if (value === null) store.delete(key);
            else store.set(key, value);
        },
    } as unknown as SettingsRepository & { store: Map<string, string> };
}

describe('ensureStreamSecrets', () => {
    it('seeds every secret on a first boot', async () => {
        const repository = fakeRepository();

        expect(await ensureStreamSecrets(repository, encryption)).toBe(true);

        for (const key of STREAM_SECRET_KEYS) {
            const stored = repository.store.get(key);
            expect(stored).toBeDefined();
            // Stored encrypted, and long enough to be worth having.
            expect(stored).not.toMatch(/^[A-Za-z0-9_-]{32}$/);
            expect(encryption.decrypt(stored!).length).toBeGreaterThanOrEqual(32);
        }
    });

    it('never overwrites a secret that is already set', async () => {
        const chosen = encryption.encrypt('the-operators-own-password');
        const repository = fakeRepository({ [STREAM_KEYS.sourcePassword]: chosen });

        expect(await ensureStreamSecrets(repository, encryption)).toBe(true);

        expect(repository.store.get(STREAM_KEYS.sourcePassword)).toBe(chosen);
    });

    it('is idempotent: a second run seeds nothing and reports nothing', async () => {
        const repository = fakeRepository();
        await ensureStreamSecrets(repository, encryption);
        const before = new Map(repository.store);

        expect(await ensureStreamSecrets(repository, encryption)).toBe(false);

        expect(repository.store).toEqual(before);
    });

    it('gives each secret a distinct value', async () => {
        // One shared secret would mean the bridge, the harbor and Icecast all fall to
        // whichever of them leaked.
        const repository = fakeRepository();
        await ensureStreamSecrets(repository, encryption);

        const plaintexts = STREAM_SECRET_KEYS.map(key => encryption.decrypt(repository.store.get(key)!));
        expect(new Set(plaintexts).size).toBe(STREAM_SECRET_KEYS.length);
    });
});

describe('resolveStreamSettings', () => {
    it('fills defaults matching the committed radio.default.env', () => {
        const settings = resolveStreamSettings(settingsConfig().config, encryption);

        expect(settings.mount).toBe('/live.mp3');
        expect(settings.bitrate).toBe('128');
        expect(settings.icecastHost).toBe('icecast');
        expect(settings.icecastPort).toBe('8000');
        expect(settings.sourcePassword).toBeUndefined();
    });

    it('decrypts the stored secrets', () => {
        const { config } = settingsConfig({ [STREAM_KEYS.sourcePassword]: encryption.encrypt('hunter2') });

        expect(resolveStreamSettings(config, encryption).sourcePassword).toBe('hunter2');
    });

    it('passes through a value that will not decrypt, rather than failing the read', () => {
        // An operator seeding a password by hand with psql is reasonable, and failing
        // here would take the whole render down over one setting.
        const { config } = settingsConfig({ [STREAM_KEYS.adminPassword]: 'set-by-hand' });

        expect(resolveStreamSettings(config, encryption).adminPassword).toBe('set-by-hand');
    });

    it('lets an absent key fall through to its default, and an empty one stay empty', () => {
        // The distinction the defaults are written against. Reading every key with a default of
        // `''` instead of asking whether it is there at all would collapse the two, and a fresh
        // install would advertise a station with no name rather than "Deadair".
        const { config } = settingsConfig({ [STREAM_KEYS.genre]: '' });

        const settings = resolveStreamSettings(config, encryption);

        expect(settings.title).toBe('Deadair');
        expect(settings.genre).toBe('');
    });
});

describe('mountPathFor', () => {
    it('swaps the extension of the MP3 mount', () => {
        expect(mountPathFor('/live.mp3', 'opus')).toBe('/live.opus');
        expect(mountPathFor('/live.mp3', 'aac')).toBe('/live.aac');
        expect(mountPathFor('/live.mp3', 'flac')).toBe('/live.flac');
    });

    it('leaves the MP3 mount exactly as the operator wrote it', () => {
        // It is the setting, not a derivation of one. A station whose mount is `/stream`
        // must not have it silently become `/stream.mp3`.
        expect(mountPathFor('/stream', 'mp3')).toBe('/stream');
        expect(mountPathFor('/live.mp3', 'mp3')).toBe('/live.mp3');
    });

    it('follows a renamed mount, which is the whole reason it derives', () => {
        expect(mountPathFor('/wbcn.mp3', 'opus')).toBe('/wbcn.opus');
    });

    it('appends rather than replacing when the mount has no extension', () => {
        expect(mountPathFor('/live', 'opus')).toBe('/live.opus');
    });

    it('does not mistake a directory dot for an extension', () => {
        // The `.` is before the last slash, so there is no extension to swap and the
        // format is appended. Cutting at the last dot regardless would produce
        // `/v1.opus` and lose the mount name entirely.
        expect(mountPathFor('/v1.2/live', 'opus')).toBe('/v1.2/live.opus');
    });
});

describe('streamMounts', () => {
    /** The station as it comes: MP3 and nothing else. */
    const base = () => resolveStreamSettings(settingsConfig().config, encryption);

    it('publishes MP3 alone until the operator asks for more', () => {
        expect(streamMounts(base())).toEqual([{ format: 'mp3', path: '/live.mp3', bitrateKbps: 128 }]);
    });

    it('adds each format the operator switched on, MP3 always first', () => {
        const { config } = settingsConfig({
            [STREAM_KEYS.opusEnabled]: 'true',
            [STREAM_KEYS.aacEnabled]: 'true',
            [STREAM_KEYS.flacEnabled]: 'true',
        });

        expect(streamMounts(resolveStreamSettings(config, encryption))).toEqual([
            { format: 'mp3', path: '/live.mp3', bitrateKbps: 128 },
            { format: 'opus', path: '/live.opus', bitrateKbps: 160 },
            { format: 'aac', path: '/live.aac', bitrateKbps: 192 },
            // No bitrate: FLAC is lossless and has none to set.
            { format: 'flac', path: '/live.flac' },
        ]);
    });

    it('reads a switch that is stored OFF as off', () => {
        // The case a test handing over a real boolean cannot make: every layer of the
        // config holds strings, and `'false'` is truthy. Read as a boolean this switch
        // could be turned on and never back off, in silence.
        const { config } = settingsConfig({ [STREAM_KEYS.opusEnabled]: 'false' });

        expect(streamMounts(resolveStreamSettings(config, encryption))).toHaveLength(1);
    });

    it('takes an operator word for yes that is not the console word', () => {
        const { config } = settingsConfig({ [STREAM_KEYS.opusEnabled]: 'on' });

        expect(streamMounts(resolveStreamSettings(config, encryption)).map(mount => mount.format)).toEqual(['mp3', 'opus']);
    });

    it('falls back to the declared bitrate rather than publishing a mount with none', () => {
        // A row edited by hand into something unparseable. The encoder needs a number,
        // and refusing to publish the mount over it would be a worse answer than the
        // default the console would have offered.
        const { config } = settingsConfig({ [STREAM_KEYS.opusEnabled]: 'yes', [STREAM_KEYS.opusBitrate]: 'loud' });

        expect(streamMounts(resolveStreamSettings(config, encryption))[1]?.bitrateKbps).toBe(160);
    });

    it('derives every mount from a renamed stream.mount', () => {
        const { config } = settingsConfig({ [STREAM_KEYS.mount]: '/wbcn.mp3', [STREAM_KEYS.aacEnabled]: 'true' });

        expect(streamMounts(resolveStreamSettings(config, encryption)).map(mount => mount.path)).toEqual(['/wbcn.mp3', '/wbcn.aac']);
    });
});
