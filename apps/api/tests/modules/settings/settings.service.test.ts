// The write path here has two properties that are not obvious and are expensive to get wrong: it
// is PARTIAL, so a console sending one field cannot clear the rest, and it never refreshes the
// config inline, because a request's own transaction has not committed yet and the reload happens
// on another connection. The read path has one: a secret is reported as a boolean and never as a
// value, in either direction.

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { AppConfigStore } from '@maroonedsoftware/appconfig';

import { SettingsService } from '../../../src/modules/settings/settings.service.js';
import type { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { AIR_MODE_KEY } from '../../../src/modules/playout/air.mode.js';
import { STREAM_KEYS, STREAM_SECRET_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { MAIL_KEYS } from '../../../src/modules/mail/mail.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';
import type { StreamService } from '../../../src/modules/stream/stream.service.js';

const encryption = new EncryptionProvider(randomBytes(32));

function build(stored: Record<string, string> = {}) {
    const station = settingsConfig(stored);
    const written: { key: string; value: string | null }[] = [];

    const repository = {
        set: vi.fn(async (key: string, value: string | null) => {
            written.push({ key, value });
        }),
    } as unknown as SettingsRepository;

    const reload = vi.fn(async () => {
        // What the running app does when the store rebuilds: the config catches up with the table.
        for (const write of written) station.set(write.key, write.value ?? undefined);
    });
    const configStore = { reload } as unknown as AppConfigStore;
    const afterCommit = new AfterCommit();
    const materialize = vi.fn(async () => true);
    const stream = { materialize } as unknown as StreamService;

    return {
        service: new SettingsService(repository, configStore, station.config, encryption, stream, afterCommit),
        repository,
        reload,
        materialize,
        afterCommit,
        written,
        station,
    };
}

describe('SettingsService.read', () => {
    it('fills in the defaults for a station nobody has configured', () => {
        const { service } = build();

        const model = service.read();

        expect(model.values[STREAM_KEYS.title]).toBe('Deadair');
        expect(model.values[AIR_MODE_KEY]).toBe('audience');
    });

    it('reports a secret as whether it is stored, never as what it is', () => {
        const ciphertext = encryption.encrypt('hunter2');
        const { service } = build({ [MAIL_KEYS.password]: ciphertext });

        const model = service.read();

        expect(model.configured[MAIL_KEYS.password]).toBe(true);
        // Neither the plaintext nor the ciphertext is anywhere in the answer.
        expect(JSON.stringify(model)).not.toContain(ciphertext);
        expect(JSON.stringify(model)).not.toContain('hunter2');
    });

    it('reports a secret nobody stored as not configured', () => {
        const { service } = build();

        expect(service.read().configured[MAIL_KEYS.password]).toBe(false);
    });

    it('says nothing at all about the secrets the stream seeds for itself', () => {
        // Stored, and not the operator's: the console has nothing to draw for them, so the read
        // model does not so much as admit they exist.
        const stored = Object.fromEntries(STREAM_SECRET_KEYS.map(key => [key, encryption.encrypt('seeded')]));
        const { service } = build(stored);

        const model = service.read();

        for (const key of STREAM_SECRET_KEYS) {
            expect(model.configured[key], key).toBeUndefined();
            expect(model.descriptors.some(descriptor => descriptor.key === key), key).toBe(false);
        }
    });

    it('carries the descriptors, so a console needs nothing else to draw the form', () => {
        const { service } = build();

        expect(service.read().descriptors.some(descriptor => descriptor.key === AIR_MODE_KEY)).toBe(true);
    });
});

describe('SettingsService.write', () => {
    it('writes only the keys it was given', async () => {
        const { service, written } = build({ [STREAM_KEYS.title]: 'Old FM' });

        await service.write({ [AIR_MODE_KEY]: 'always' });

        expect(written).toEqual([{ key: AIR_MODE_KEY, value: 'always' }]);
    });

    it('refuses a key nobody declared rather than storing a row nothing reads', async () => {
        const { service, written } = build();

        await expect(service.write({ 'stream.titel': 'Typo FM' })).rejects.toThrow();
        expect(written).toEqual([]);
    });

    it('writes nothing at all when any one value is refused', async () => {
        // A partly applied form is the worst outcome: the operator sees an error and has no way to
        // know which half of what they typed is now live.
        const { service, written } = build();

        await expect(service.write({ [AIR_MODE_KEY]: 'always', [STREAM_KEYS.publicUrl]: 'not-a-url' })).rejects.toThrow();

        expect(written).toEqual([]);
    });

    it('reports every refusal at once, not just the first', async () => {
        const { service } = build();

        const error = await service.write({ [STREAM_KEYS.publicUrl]: 'nope', [AIR_MODE_KEY]: 'sometimes' }).catch((thrown: unknown) => thrown);

        expect(JSON.stringify(error)).toContain('Public URL');
        expect(JSON.stringify(error)).toContain('sometimes');
    });

    it('encrypts a secret on the way in', async () => {
        const { service, written } = build();

        await service.write({ [MAIL_KEYS.password]: 'hunter2' });

        expect(written[0]!.value).not.toBe('hunter2');
        expect(encryption.decrypt(written[0]!.value!)).toBe('hunter2');
    });

    it('clears a secret submitted blank rather than storing an empty one', async () => {
        // How an operator removes a password. An empty string stored as ciphertext would read back
        // as "configured" and decrypt to nothing.
        const { service, written } = build();

        await service.write({ [MAIL_KEYS.password]: '   ' });

        expect(written).toEqual([{ key: MAIL_KEYS.password, value: null }]);
    });

    it('refuses to change a secret the stream seeds for itself', async () => {
        // A changed one is adopted by Icecast and Liquidsoap only on their next restart, and a
        // cleared one stops the stream config rendering at all, so neither is on offer.
        const { service, written } = build();

        for (const key of STREAM_SECRET_KEYS) {
            await expect(service.write({ [key]: 'chosen' }), key).rejects.toThrow();
            await expect(service.write({ [key]: null }), key).rejects.toThrow();
        }
        expect(written).toEqual([]);
    });

    it('puts a setting back to its default when it is explicitly cleared', async () => {
        // The only way to undo a change. A number field cleared in the console arrives as null,
        // and without this it would be refused as "takes a number" and the default would be
        // reachable only by remembering what it was.
        const { service, written } = build({ [STREAM_KEYS.title]: 'Old FM' });

        const model = await service.write({ [STREAM_KEYS.title]: null });

        expect(written).toEqual([{ key: STREAM_KEYS.title, value: null }]);
        expect(model.values[STREAM_KEYS.title]).toBe('Deadair');
    });

    it('does not refresh the config until the transaction commits', async () => {
        const { service, reload, afterCommit } = build();

        await service.write({ [AIR_MODE_KEY]: 'always' });

        // Inline, this would read the row as it stood BEFORE the write and cache that.
        expect(reload).not.toHaveBeenCalled();

        await afterCommit.run();

        expect(reload).toHaveBeenCalled();
    });

    it('answers with what was written, not with what the config still says', async () => {
        // The config refreshes after this request commits, so reading it back to build the answer
        // would hand the console the value the operator has just replaced.
        const { service } = build();

        const model = await service.write({ [AIR_MODE_KEY]: 'always', [MAIL_KEYS.password]: 'hunter2' });

        expect(model.values[AIR_MODE_KEY]).toBe('always');
        expect(model.configured[MAIL_KEYS.password]).toBe(true);
        // And still nothing about what the secret is.
        expect(JSON.stringify(model)).not.toContain('hunter2');
    });

    it('leaves everything it was not given at its current value in the answer', async () => {
        const { service } = build({ [STREAM_KEYS.title]: 'Old FM' });

        const model = await service.write({ [AIR_MODE_KEY]: 'always' });

        expect(model.values[STREAM_KEYS.title]).toBe('Old FM');
    });
});

describe('SettingsService and the containers that cannot read the database', () => {
    it('re-renders the stream config after a stream setting changes', async () => {
        const { service, materialize, afterCommit } = build();

        await service.write({ [STREAM_KEYS.bitrate]: '192' });
        expect(materialize).not.toHaveBeenCalled();

        await afterCommit.run();

        expect(materialize).toHaveBeenCalled();
    });

    it('renders from the settings as they now are, not as they were', async () => {
        // The renderer reads these through the same config this request has just changed, so the
        // order of the two deferred tasks is the whole of whether the rendered file is right.
        const { service, reload, materialize, afterCommit } = build();
        const order: string[] = [];
        reload.mockImplementation(async () => void order.push('reload'));
        materialize.mockImplementation(async () => {
            order.push('materialize');
            return true;
        });

        await service.write({ [STREAM_KEYS.bitrate]: '192' });
        await afterCommit.run();

        expect(order).toEqual(['reload', 'materialize']);
    });

    it('does not re-render for a setting no container reads', async () => {
        const { service, materialize, afterCommit } = build();

        await service.write({ [AIR_MODE_KEY]: 'always' });
        await afterCommit.run();

        expect(materialize).not.toHaveBeenCalled();
    });
});
