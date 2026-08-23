import { describe, expect, it } from 'vitest';

import { AppConfigSourceEnv } from '../../src/server/env.config.source.js';

describe('AppConfigSourceEnv', () => {
    it('answers with the variables it was given', async () => {
        const source = new AppConfigSourceEnv('__', { DATABASE_HOST: 'db.example.com', DATABASE_PORT: '5432' });

        await expect(source.load()).resolves.toMatchObject({ DATABASE_HOST: 'db.example.com', DATABASE_PORT: '5432' });
        await expect(source.get('DATABASE_HOST')).resolves.toBe('db.example.com');
    });

    it('nests on the separator, so a grouped key means the same here as in a file', async () => {
        const source = new AppConfigSourceEnv('__', { GROUP__KEY: 'value' });

        await expect(source.load()).resolves.toMatchObject({ GROUP: { KEY: 'value' } });
    });

    it('drops variables that are set to nothing rather than reporting them as empty', async () => {
        const source = new AppConfigSourceEnv('__', { PRESENT: 'yes', ABSENT: undefined });

        const loaded = await source.load();

        expect(loaded).toMatchObject({ PRESENT: 'yes' });
        expect('ABSENT' in loaded).toBe(false);
    });

    // The one that matters. The store re-runs its sources whenever the settings table changes, and
    // `scrubProcessEnv` has deleted the secrets from the environment by then. A source that read
    // the environment live would answer with the database password on the first pass and with
    // nothing on every pass after it — losing the credentials at an arbitrary later moment, with
    // nothing reporting that it had happened.
    it('keeps answering with what it was built from, after the environment has been scrubbed', async () => {
        const environment: NodeJS.ProcessEnv = { DATABASE_PASSWORD: 'secret' };
        const source = new AppConfigSourceEnv('__', environment);

        delete environment.DATABASE_PASSWORD;

        await expect(source.get('DATABASE_PASSWORD')).resolves.toBe('secret');
        await expect(source.load()).resolves.toMatchObject({ DATABASE_PASSWORD: 'secret' });
    });

    it('watches nothing, because the environment a process was started with cannot change', () => {
        const source = new AppConfigSourceEnv();

        expect(() => source.watch()()).not.toThrow();
    });
});
