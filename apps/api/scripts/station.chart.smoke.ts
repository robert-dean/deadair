/**
 * The station's own chart, against a real Postgres: the week boundaries in the station's zone, the
 * three counts, the standings read through the catalog's own rating expression, and the ranking on
 * top. The unit tests fix the ranking with counts somebody chose; this is what fixes the SQL that
 * produces the counts, which a fake database only compiles.
 *
 * Everything is written under a station key nothing else uses, inside a transaction that is thrown
 * away, so it is safe against a database with a real library in it.
 *
 *   node --import @swc-node/register/esm-register ./scripts/station.chart.smoke.ts
 *
 * Reads `DATABASE_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` from the environment, then from
 * `apps/api/.env`.
 */

const env = (key: string, fallback: string): string => {
    if (process.env[key]) return process.env[key]!;
    try {
        const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
        return line?.[1]?.trim() || fallback;
    } catch {
        return fallback;
    }
};

import { readFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import { normalizeKey } from '../src/modules/catalog/catalog.keys.js';
import { songKey, artistKey } from '../src/modules/director/rotation.keys.js';
import { StationChartRepository } from '../src/modules/charts/station.chart.repository.js';
import { favouritesEdition, weeklyEdition } from '../src/modules/charts/station.chart.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

class Rollback extends Error {}

const STATION = 'zzsmoke-chart';
/** A zone well away from UTC, so a week read in the wrong one shows. */
const ZONE = 'America/Los_Angeles';

try {
    await db.transaction().execute(async trx => {
        const repository = new StationChartRepository(trx as never);
        const edition = await repository.editionWeek(ZONE);
        say(`edition week: ${edition}`);

        const artist = async (name: string, rating = 0) =>
            (
                await trx
                    .insertInto('deadair.artists')
                    .values({ name, artistKey: normalizeKey(name), rating })
                    .returning('id')
                    .executeTakeFirstOrThrow()
            ).id;
        const track = async (artistId: string, artistName: string, title: string, rating = 0) => ({
            id: (
                await trx
                    .insertInto('deadair.tracks')
                    .values({ artistId, artists: artistName, title, titleKey: normalizeKey(title), rating })
                    .returning('id')
                    .executeTakeFirstOrThrow()
            ).id,
            title,
            artist: artistName,
        });

        const portishead = await artist('zzsmoke Portishead');
        const massive = await artist('zzsmoke Massive Attack', -1);
        const bjork = await artist('zzsmoke Bjork');

        const gloryBox = await track(portishead, 'zzsmoke Portishead', 'Glory Box', 1);
        const roads = await track(portishead, 'zzsmoke Portishead', 'Roads');
        const teardrop = await track(massive, 'zzsmoke Massive Attack', 'Teardrop');
        const hyperballad = await track(bjork, 'zzsmoke Bjork', 'Hyperballad');
        const armyOfMe = await track(bjork, 'zzsmoke Bjork', 'Army of Me');

        // A local wall-clock time in the station's zone, so each row lands where the test means it to.
        const at = (week: string, dayOffset: number, time: string) =>
            sql<Date>`((${week}::date + ${dayOffset}::int)::timestamp + ${time}::time) at time zone ${ZONE}`;
        const before = (week: string) => sql<string>`to_char(${week}::date - 7, 'YYYY-MM-DD')`;
        const weekBefore = (await sql<{ week: string }>`select ${before(edition)} as week`.execute(trx)).rows[0]!.week;

        const play = (t: { id: string; title: string; artist: string }, when: ReturnType<typeof at>) =>
            trx
                .insertInto('deadair.playHistory')
                .values({
                    stationKey: STATION,
                    trackId: t.id,
                    pluginId: 'zzsmoke',
                    externalId: t.id,
                    title: t.title,
                    artists: t.artist,
                    artist: t.artist,
                    songKey: songKey(t.title, [t.artist]),
                    artistKey: artistKey([t.artist]),
                    airedAt: when as never,
                })
                .execute();

        // The edition week: Roads four plays and a skip, Glory Box three (liked), Teardrop ten (its
        // artist disliked), Hyperballad one request and no plays, Army of Me one play.
        for (let day = 0; day < 4; day += 1) await play(roads, at(edition, day, '12:00'));
        for (let day = 0; day < 3; day += 1) await play(gloryBox, at(edition, day, '13:00'));
        for (let day = 0; day < 10; day += 1) await play(teardrop, at(edition, day % 7, '14:00'));
        await play(armyOfMe, at(edition, 2, '15:00'));
        await trx
            .insertInto('deadair.trackSkips')
            .values({
                stationKey: STATION,
                trackId: roads.id,
                songKey: songKey(roads.title, [roads.artist]),
                artistKey: artistKey([roads.artist]),
                skippedAt: at(edition, 1, '12:01') as never,
            })
            .execute();
        await trx
            .insertInto('deadair.listenerRequests')
            .values({
                stationKey: STATION,
                requesterKey: 'zzsmoke',
                requesterName: 'zzsmoke',
                trackId: hyperballad.id,
                title: hyperballad.title,
                artist: hyperballad.artist,
                createdAt: at(edition, 3, '20:00') as never,
            })
            .execute();
        // A declined request counts for nothing.
        await trx
            .insertInto('deadair.listenerRequests')
            .values({
                stationKey: STATION,
                requesterKey: 'zzsmoke-2',
                requesterName: 'zzsmoke',
                trackId: armyOfMe.id,
                title: armyOfMe.title,
                artist: armyOfMe.artist,
                status: 'declined',
                createdAt: at(edition, 3, '20:00') as never,
            })
            .execute();

        // The boundaries: 23:30 on the Sunday before the edition belongs to the week before, and
        // 00:30 on the Monday after belongs to the week still being played, which no edition reads.
        await play(gloryBox, at(edition, -1, '23:30'));
        await play(gloryBox, at(weekBefore, 0, '10:00'));
        await play(roads, at(edition, 7, '00:30'));
        await play(roads, at(edition, 7, '01:30'));

        const history = await repository.history(STATION, ZONE, edition, 52);
        const weekly = weeklyEdition(history.tallies, history.standings, edition);

        check(
            'the weekly edition, ranked',
            weekly.map(({ rank, title, plays, requests, liked, lastWeek, weeksOn }) => ({ rank, title, plays, requests, liked, lastWeek, weeksOn })),
            [
                // 3 plays lifted by the like: 4.5.
                { rank: 1, title: 'Glory Box', plays: 3, requests: 0, liked: true, lastWeek: 1, weeksOn: 2 },
                // 1 request: 3.
                { rank: 2, title: 'Hyperballad', plays: 0, requests: 1, liked: false, weeksOn: 1 },
                // 4 plays less a skip: 3, and Hyperballad's request breaks the tie.
                { rank: 3, title: 'Roads', plays: 4, requests: 0, liked: false, weeksOn: 1 },
            ],
        );
        check(
            'a disliked artist never charts',
            weekly.some(entry => entry.title === 'Teardrop'),
            false,
        );
        check('the lead artist is the name a chart entry carries', weekly[0]?.artist, 'zzsmoke Portishead');
        check('a liked record stands liked', history.standings.get(songKey(gloryBox.title, [gloryBox.artist])), { barred: false, liked: true });
        check("a disliked artist's record stands barred", history.standings.get(songKey(teardrop.title, [teardrop.artist])), {
            barred: true,
            liked: false,
        });

        const favourites = favouritesEdition(history.tallies, history.standings, 100);
        check(
            'the favourites',
            favourites.map(({ rank, title, plays }) => ({ rank, title, plays })),
            [{ rank: 1, title: 'Glory Box', plays: 5 }],
        );

        check('a date in the current week answers last week', await repository.editionWeek(ZONE, '2999-01-01'), edition);
        check('a date names the week it falls in', await repository.editionWeek(ZONE, '2026-10-29'), '2026-10-26');

        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}
