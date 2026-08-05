// Two behaviours matter here and neither is visible from a running station.
//
// `ensureStreamSecrets` must never overwrite a secret the operator chose: doing so
// would rotate the Icecast password out from under a connected source at boot.
// `resolveStreamSettings` must not fail the whole read because one value will not
// decrypt, because that read is what renders the config for both containers.

import { randomBytes } from 'node:crypto';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { describe, expect, it } from 'vitest';

import { ensureStreamSecrets, resolveStreamSettings, STREAM_KEYS, STREAM_SECRET_KEYS } from '../../../src/modules/stream/stream.settings.js';
import type { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';

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
    it('fills defaults matching the committed radio.default.env', async () => {
        const settings = await resolveStreamSettings(fakeRepository(), encryption);

        expect(settings.mount).toBe('/live.mp3');
        expect(settings.bitrate).toBe('128');
        expect(settings.icecastHost).toBe('icecast');
        expect(settings.icecastPort).toBe('8000');
        expect(settings.sourcePassword).toBeUndefined();
    });

    it('decrypts the stored secrets', async () => {
        const repository = fakeRepository({ [STREAM_KEYS.sourcePassword]: encryption.encrypt('hunter2') });

        expect((await resolveStreamSettings(repository, encryption)).sourcePassword).toBe('hunter2');
    });

    it('passes through a value that will not decrypt, rather than failing the read', async () => {
        // An operator seeding a password by hand with psql is reasonable, and failing
        // here would take the whole render down over one setting.
        const repository = fakeRepository({ [STREAM_KEYS.adminPassword]: 'set-by-hand' });

        expect((await resolveStreamSettings(repository, encryption)).adminPassword).toBe('set-by-hand');
    });
});
