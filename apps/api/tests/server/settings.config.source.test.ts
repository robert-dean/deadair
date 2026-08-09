import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppConfig, AppConfigBuilder, type AppConfigSource } from '@maroonedsoftware/appconfig';

import { SETTINGS_NOTIFY_CHANNEL, settingsConfigSource } from '../../src/server/settings.config.source.js';

const migration = fileURLToPath(new URL('../../data/migrations/0003_settings.sql', import.meta.url));

/** A source standing in for the settings table, so the merge can be exercised without a database. */
const sourceOf = (values: Record<string, unknown>): AppConfigSource => ({
    load: async () => values,
    get: async () => undefined,
    watch: () => () => {},
});

describe('the settings config source', () => {
    it('listens on the channel the migration actually notifies', async () => {
        // The one coupling in this layer that no type can check: the channel name is a string in
        // `settings.config.source.ts` and a string in plpgsql, and a rename on either side would
        // leave a listener that never fires and a store that silently serves boot-time settings
        // forever. Read the SQL rather than restating the name in a second constant.
        const sql = await readFile(migration, 'utf8');

        expect(sql).toContain(`pg_notify('${SETTINGS_NOTIFY_CHANNEL}'`);
    });

    it('reads the table the migration actually creates', async () => {
        const sql = await readFile(migration, 'utf8');

        expect(sql).toContain('create table deadair.settings');
        expect(sql).toContain('key text primary key');
    });

    it('connects as the runtime role', () => {
        const config = new AppConfig({
            DATABASE_HOST: 'db',
            DATABASE_PORT: 5432,
            DATABASE_USER: 'postgres',
            DATABASE_PASSWORD: 'owner-secret',
            DATABASE_NAME: 'deadair',
            DATABASE_APP_USER: 'app_user',
            DATABASE_APP_PASSWORD: 'app-secret',
        });

        const source = settingsConfigSource(config, { info: () => {}, warn: () => {}, error: () => {} } as never);

        // Reaching into the source's own state, because the alternative is a live database. What
        // is being pinned is that the credentials were resolved to LITERALS at construction: a
        // `${env:…}` template here would connect once and then fail on every reload, after
        // `scrubProcessEnv()` has emptied the environment it would re-resolve against.
        const connection = (source as unknown as { source: { connection: Record<string, unknown> } }).source.connection;

        expect(connection.user).toBe('app_user');
        expect(connection.password).toBe('app-secret');
    });
});

describe('the config merge', () => {
    it('keeps a dotted settings key as one flat key rather than a path', async () => {
        // The assumption the whole settings layer rests on. `deadair.settings` keys are dotted
        // (`stream.title`), and if the merge read those as paths into a nested object then
        // `config.get('stream.title')` would answer undefined and every consumer would silently
        // fall back to its default.
        const config = await new AppConfigBuilder()
            .addSource(sourceOf({ PORT: 3333 }))
            .addSource(sourceOf({ 'stream.title': 'From The Table', 'playout.airMode': 'always' }))
            .buildSnapshot();

        expect(config.get('stream.title')).toBe('From The Table');
        expect(config.get('playout.airMode')).toBe('always');
        expect(config.get('PORT')).toBe(3333);
    });

    it('lets the settings layer win over the environment on the same key', async () => {
        // Nothing collides today — env keys are SCREAMING_SNAKE and settings keys are dotted — but
        // the ordering in `setup.server.ts` is a deliberate choice and this is what it means.
        const config = await new AppConfigBuilder()
            .addSource(sourceOf({ shared: 'from-env' }))
            .addSource(sourceOf({ shared: 'from-settings' }))
            .buildSnapshot();

        expect(config.get('shared')).toBe('from-settings');
    });
});
