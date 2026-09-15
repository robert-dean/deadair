// What is pinned here is the SQL: that a refresh writes only what a feed may say about an episode and
// never what the station did with it, that "new" comes from the database's own answer, and that a
// claim the table cannot hold is dropped rather than refused.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { PodcastEpisodeRepository } from '../../../src/modules/podcasts/podcast.episode.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { PodcastEpisodeListing } from '../../../src/modules/podcasts/podcast.episode.js';

interface Captured {
    queries: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles the statement for real, records it, and answers with rows somebody chose. */
function fakeDb(rows: unknown[], captured: Captured): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.queries.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows } as QueryResult<never>;
        },
        streamQuery: () => {
            throw new Error('nothing here streams');
        },
    };

    const driver: Driver = Object.assign(new DummyDriver(), { acquireConnection: async () => connection });

    const dialect: Dialect = {
        createAdapter: () => postgres.createAdapter(),
        createIntrospector: db => postgres.createIntrospector(db),
        createQueryCompiler: () => postgres.createQueryCompiler(),
        createDriver: () => driver,
    };

    return new Kysely<DB>({ dialect, plugins: [...KyselyDefaultPlugins] });
}

const listing = (overrides: Partial<PodcastEpisodeListing> = {}): PodcastEpisodeListing => ({
    showId: 'deadair.podcast:73b7fb89',
    episodeId: 'ep12',
    showTitle: 'The Long Wave',
    title: 'Episode 12',
    audioUrl: 'https://cdn.example.com/12.mp3',
    publishedAt: Date.parse('2026-09-14T06:00:00.000Z'),
    durationMs: 3_723_000,
    ...overrides,
});

describe('PodcastEpisodeRepository.record', () => {
    it('upserts on the show and the episode, and answers how many rows were new', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(fakeDb([{ inserted: true }, { inserted: false }], captured), new StationIdentity());

        const added = await repository.record([listing(), listing({ episodeId: 'ep11' })]);

        expect(added).toBe(1);
        const [query] = captured.queries;
        expect(query?.sql).toContain('insert into "deadair"."podcast_episodes"');
        expect(query?.sql).toContain('on conflict ("station_key", "show_id", "episode_id") do update set');
        expect(query?.sql).toContain('(xmax = 0)');
    });

    // The whole reason a refresh can run every half hour for a month: it can describe an episode again
    // and never undo what the station did with it.
    it('never writes what the station did with an episode', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(fakeDb([{ inserted: false }], captured), new StationIdentity());

        await repository.record([listing()]);

        const updateSet = captured.queries[0]?.sql.split('do update set')[1] ?? '';
        for (const column of ['segment_id', 'aired_at', 'fetch_requested_at', 'fetch_attempts', 'fetch_error', 'scheduled_for']) {
            expect(updateSet, column).not.toContain(`"${column}"`);
        }
        expect(updateSet).toContain('"seen_at" = now()');
    });

    it('drops a size claim the column cannot hold, and keeps the rest of the listing', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(fakeDb([{ inserted: true }], captured), new StationIdentity());

        await repository.record([listing({ audioBytes: 3_000_000_000 }), listing({ episodeId: 'ep13', audioBytes: 55_102_934 })]);

        const parameters = captured.queries[0]?.parameters ?? [];
        expect(parameters).not.toContain(3_000_000_000);
        expect(parameters).toContain(55_102_934);
    });

    it('asks nothing of the database for an empty listing', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.record([])).toBe(0);
        expect(captured.queries).toHaveLength(0);
    });
});

describe('PodcastEpisodeRepository.list', () => {
    it('reads newest first, scoped to the station, and maps nulls to absent fields', async () => {
        const captured: Captured = { queries: [] };
        const published = DateTime.fromISO('2026-09-14T06:00:00.000Z');
        const seen = DateTime.fromISO('2026-09-15T08:00:00.000Z');
        const repository = new PodcastEpisodeRepository(
            fakeDb(
                [
                    {
                        id: 'row-1',
                        show_id: 'deadair.podcast:73b7fb89',
                        episode_id: 'ep12',
                        show_title: 'The Long Wave',
                        title: 'Episode 12',
                        summary: null,
                        url: undefined,
                        published_at: published,
                        duration_ms: 3_723_000,
                        audio_url: 'https://cdn.example.com/12.mp3',
                        audio_mime: 'audio/mpeg',
                        audio_bytes: null,
                        artwork_url: null,
                        explicit: false,
                        seen_at: seen,
                        segment_id: null,
                        fetch_requested_at: null,
                        fetch_attempts: 0,
                        fetch_error: null,
                        scheduled_for: null,
                        aired_at: null,
                    },
                ],
                captured,
            ),
            new StationIdentity(),
        );

        const [episode] = await repository.list({ showId: 'deadair.podcast:73b7fb89', limit: 10 });

        expect(episode).toEqual({
            id: 'row-1',
            showId: 'deadair.podcast:73b7fb89',
            episodeId: 'ep12',
            showTitle: 'The Long Wave',
            title: 'Episode 12',
            audioUrl: 'https://cdn.example.com/12.mp3',
            audioMime: 'audio/mpeg',
            publishedAt: published.toMillis(),
            durationMs: 3_723_000,
            explicit: false,
            seenAt: seen.toMillis(),
            fetchAttempts: 0,
        });

        const [query] = captured.queries;
        expect(query?.sql).toContain('"station_key" = $1');
        expect(query?.sql).toContain('"show_id" = $2');
        expect(query?.sql).toContain('order by published_at desc nulls last, "id" asc');
        expect(query?.parameters).toEqual(['main', 'deadair.podcast:73b7fb89', 10]);
    });
});

describe('PodcastEpisodeRepository.newest', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
        id: 'row-1',
        show_id: 'deadair.podcast:73b7fb89',
        episode_id: 'ep12',
        show_title: 'The Long Wave',
        title: 'Episode 12',
        audio_url: 'https://cdn.example.com/12.mp3',
        published_at: DateTime.fromISO('2026-09-14T06:00:00.000Z'),
        seen_at: DateTime.fromISO('2026-09-15T08:00:00.000Z'),
        fetch_attempts: 0,
        ...overrides,
    });

    it('reads the newest dated episode of the show, scoped to the station', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(fakeDb([row()], captured), new StationIdentity());

        expect((await repository.newest('deadair.podcast:73b7fb89'))?.episodeId).toBe('ep12');

        const [query] = captured.queries;
        expect(query?.sql).toContain('"published_at" is not null');
        expect(query?.sql).toContain('order by "published_at" desc');
        expect(query?.parameters).toEqual(['main', 'deadair.podcast:73b7fb89', 1]);
    });

    // Newest and never back through the catalogue: a band on a night the show published nothing
    // declines rather than reaching into last month.
    it('answers nothing when the newest has already aired, rather than an older one', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(
            fakeDb([row({ aired_at: DateTime.fromISO('2026-09-14T21:00:00.000Z') })], captured),
            new StationIdentity(),
        );

        expect(await repository.newest(undefined)).toBeUndefined();
        expect(captured.queries[0]?.sql).not.toContain('"show_id" =');
    });
});

describe('PodcastEpisodeRepository.markAired', () => {
    it('keeps the first airing, so a second hand-over is not a new one', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PodcastEpisodeRepository(fakeDb([], captured), new StationIdentity());

        await repository.markAired('seg-12', Date.parse('2026-09-15T21:00:00.000Z'));

        const [query] = captured.queries;
        expect(query?.sql).toContain('"aired_at" = coalesce(aired_at, to_timestamp(');
        expect(query?.sql).toContain('"segment_id" = $');
        expect(query?.parameters).toContain('seg-12');
    });
});
