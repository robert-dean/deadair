// A station setting that is a list of rows, some cells of which are credentials: the identity
// providers the console signs in through are the first. The plugin side has done this for a while;
// what is new is that the station's own settings table holds the cells, one row per cell under
// `field/rowId/column`, and that removing a row has to delete its cell rather than orphan it.
//
// The registry declares no such setting until the sign-in section exists, so one is added here.

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { AppConfigStore } from '@maroonedsoftware/appconfig';
import { ROW_ID_KEY, rowSecretKey } from '@deadair/plugin-sdk';

import { SettingsService } from '../../../src/modules/settings/settings.service.js';
import type { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';
import type { SettingDescriptor } from '../../../src/modules/settings/settings.registry.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { settingsConfig } from '../../utils/settings.config.js';
import type { StreamService } from '../../../src/modules/stream/stream.service.js';

const FIELD = 'test.providers';

vi.mock('../../../src/modules/settings/settings.registry.js', async importOriginal => {
    const original = await importOriginal<typeof import('../../../src/modules/settings/settings.registry.js')>();
    const providers: SettingDescriptor = {
        group: 'station',
        key: 'test.providers',
        label: 'Providers',
        type: 'list',
        columns: [
            { key: 'name', label: 'Name', type: 'string', required: true },
            { key: 'secret', label: 'Secret', type: 'secret' },
        ],
    };
    const descriptors = [...original.SETTING_DESCRIPTORS, providers];
    return { ...original, SETTING_DESCRIPTORS: descriptors, findDescriptor: (key: string) => descriptors.find(d => d.key === key) };
});

const encryption = new EncryptionProvider(randomBytes(32));

function build(stored: Record<string, string> = {}) {
    const table = new Map(Object.entries(stored));
    const station = settingsConfig(stored);

    const repository = {
        set: vi.fn(async (key: string, value: string | null) => {
            if (value === null) table.delete(key);
            else table.set(key, value);
        }),
        getByPrefix: vi.fn(async (prefix: string) => new Map([...table].filter(([key]) => key.startsWith(prefix)))),
    } as unknown as SettingsRepository;

    const configStore = { reload: vi.fn(async () => undefined) } as unknown as AppConfigStore;
    const stream = { materialize: vi.fn(async () => true) } as unknown as StreamService;

    return { service: new SettingsService(repository, configStore, station.config, encryption, stream, new AfterCommit()), table };
}

const rows = (value: unknown[]) => JSON.stringify(value);
const cell = (rowId: string) => rowSecretKey(FIELD, rowId, 'secret');

describe('SettingsService with credentials inside list rows', () => {
    it('stores a typed cell encrypted under its own key, and never in the row', async () => {
        const { service, table } = build();

        await service.write({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google', secret: 'hunter2' }]) });

        expect(JSON.parse(table.get(FIELD) ?? '')).toEqual([{ [ROW_ID_KEY]: 'r1', name: 'google' }]);
        expect(encryption.decrypt(table.get(cell('r1')) ?? '')).toBe('hunter2');
        expect(table.get(FIELD)).not.toContain('hunter2');
    });

    it('keeps a stored cell when the row comes back without it', async () => {
        const ciphertext = encryption.encrypt('hunter2');
        const { service, table } = build({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google' }]), [cell('r1')]: ciphertext });

        await service.write({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google renamed' }]) });

        expect(table.get(cell('r1'))).toBe(ciphertext);
    });

    it('clears a cell the console sends as null', async () => {
        const { service, table } = build({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google' }]), [cell('r1')]: encryption.encrypt('x') });

        await service.write({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google', secret: null }]) });

        expect(table.has(cell('r1'))).toBe(false);
    });

    it('deletes the credential of a row that was removed', async () => {
        const { service, table } = build({
            [FIELD]: rows([
                { [ROW_ID_KEY]: 'r1', name: 'google' },
                { [ROW_ID_KEY]: 'r2', name: 'authelia' },
            ]),
            [cell('r1')]: encryption.encrypt('one'),
            [cell('r2')]: encryption.encrypt('two'),
        });

        await service.write({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r2', name: 'authelia' }]) });

        expect(table.has(cell('r1'))).toBe(false);
        expect(table.has(cell('r2'))).toBe(true);
    });

    it('takes every credential with it when the list is reset to its default', async () => {
        const { service, table } = build({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google' }]), [cell('r1')]: encryption.encrypt('x') });

        await service.write({ [FIELD]: null });

        expect(table.has(FIELD)).toBe(false);
        expect(table.has(cell('r1'))).toBe(false);
    });

    it('refuses rows that are not JSON text, and deletes nothing', async () => {
        const ciphertext = encryption.encrypt('x');
        const { service, table } = build({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google' }]), [cell('r1')]: ciphertext });

        await expect(service.write({ [FIELD]: [{ name: 'google' }] })).rejects.toMatchObject({ statusCode: 422 });
        expect(table.get(cell('r1'))).toBe(ciphertext);
    });

    it('reports a stored cell as configured, never as what it holds', () => {
        const ciphertext = encryption.encrypt('hunter2');
        const { service } = build({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google' }]), [cell('r1')]: ciphertext });

        const model = service.read();

        expect(model.configured[cell('r1')]).toBe(true);
        expect(JSON.stringify(model)).not.toContain(ciphertext);
    });

    it('answers a save with the cells as they now stand, before the config has caught up', async () => {
        const { service } = build({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r1', name: 'google' }]), [cell('r1')]: encryption.encrypt('x') });

        const model = await service.write({ [FIELD]: rows([{ [ROW_ID_KEY]: 'r2', name: 'authelia', secret: 'new' }]) });

        expect(model.configured[cell('r1')]).toBe(false);
        expect(model.configured[cell('r2')]).toBe(true);
    });
});
