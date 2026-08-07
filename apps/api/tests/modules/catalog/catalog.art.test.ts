// The behaviour (cached asset wins, failed row falls back, uncached row keeps its upstream URL) is
// SQL, and this repo exercises repository SQL against a real database rather than in the unit
// suite. What is worth pinning here is the shape the fragment compiles to, because two of its
// clauses are load-bearing and silent when wrong: dropping `checksum is not null` would serve a
// recorded failure as if it were art, and dropping `limit 1` would turn a second row for one source
// URL into a runtime error on a read path.

import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { artUrl } from '../../../src/modules/catalog/catalog.art.js';
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
});
