// The behaviour (cached asset wins, failed row falls back, uncached row keeps its upstream URL) is
// SQL, and this repo exercises repository SQL against a real database rather than in the unit
// suite. What is worth pinning here is the shape the fragment compiles to, because two of its
// clauses are load-bearing and silent when wrong: dropping `checksum is not null` would serve a
// recorded failure as if it were art, and dropping `limit 1` would turn a second row for one source
// URL into a runtime error on a read path.

import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { artUrl, artistArtUrl } from '../../../src/modules/catalog/catalog.art.js';
import type { DB } from '../../../src/modules/data/db.js';

/**
 * Compiles only: the pool is never used, because nothing here executes. The plugins are the app's,
 * so the alias goes through the same camel-case mapping a real read does.
 */
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: {} as never }), plugins: [...KyselyDefaultPlugins] });

const compiled = db.selectFrom('deadair.albums').select(artUrl('deadair.albums.image_url')).compile();

describe('artUrl', () => {
    it('prefers the local asset and falls back to the column', () => {
        expect(compiled.sql).toContain('coalesce');
        expect(compiled.sql).toContain("'art/' || asset.id");
        expect(compiled.sql).toContain('asset.source_url = deadair.albums.image_url');
    });

    it('ignores rows that have no bytes', () => {
        expect(compiled.sql).toContain('asset.checksum is not null');
    });

    it('takes at most one asset per source URL', () => {
        expect(compiled.sql).toContain('limit 1');
    });

    it('reports under the name the contract uses', () => {
        expect(compiled.sql).toMatch(/as "image_url"/);
    });

    // Raw SQL, so a caller passing the TypeScript spelling would compile and then fail at runtime.
    it('is given the column in database spelling', () => {
        expect(compiled.sql).not.toContain('imageUrl');
    });

    it("reports under the alias the caller asked for, for art that is not the row's own", () => {
        const track = db.selectFrom('deadair.tracks').select(artUrl('deadair.albums.image_url', 'albumImageUrl')).compile();

        expect(track.sql).toMatch(/as "album_image_url"/);
    });
});

const artist = db.selectFrom('deadair.artists').select(artistArtUrl()).compile();

describe('artistArtUrl', () => {
    it("prefers the artist's own art, cached or not, over anything borrowed", () => {
        // The artist's own column is read before the album subquery is reached.
        expect(artist.sql.indexOf('deadair.artists.image_url')).toBeLessThan(artist.sql.indexOf('from deadair.albums'));
    });

    it('falls back to a cover of theirs, and to the cached copy of it', () => {
        expect(artist.sql).toContain('deadair.albums.artist_id = deadair.artists.id');
        expect(artist.sql).toContain('asset.source_url = deadair.albums.image_url');
    });

    it('borrows from an album that has a cover and was not merged away', () => {
        expect(artist.sql).toContain('deadair.albums.image_url is not null');
        expect(artist.sql).toContain('deadair.albums.merged_into_id is null');
    });

    // Without the id the choice wanders between two albums of the same year, and an avatar that
    // changes on refresh reads as a bug.
    it('picks the newest such album, deterministically', () => {
        expect(artist.sql).toContain('order by deadair.albums.year desc nulls last, deadair.albums.id asc');
    });

    it('reports under the name the contract uses', () => {
        expect(artist.sql).toMatch(/as "image_url"/);
    });
});
