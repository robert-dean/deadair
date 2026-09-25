import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** A language this station holds, without its strings. */
export interface StoredLanguage {
    locale: string;
    name: string;
    direction: 'ltr' | 'rtl';
    madeFor: string;
    importedAt: DateTime;
}

/** A language with its strings, as the pack carried them. */
export interface StoredLanguagePack extends StoredLanguage {
    catalog: Record<string, unknown>;
}

export interface LanguageDraft {
    locale: string;
    name: string;
    direction: 'ltr' | 'rtl';
    madeFor: string;
    catalog: Record<string, unknown>;
    importedBy?: string;
}

/**
 * The console's language packs, read and written.
 *
 * A plain reader and writer. Whether a pack's strings fit is decided by the console that reads it,
 * against the English it was built with, so nothing here looks inside the catalog: it is stored and
 * handed back as it came.
 */
@Injectable()
export class ConsoleLanguageRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /** Every language this station holds, by tag. */
    async list(): Promise<StoredLanguage[]> {
        const rows = await this.db
            .selectFrom('deadair.consoleLanguages')
            .select(['locale', 'name', 'direction', 'madeFor', 'updatedAt'])
            .where('stationKey', '=', this.station.stationKey)
            .orderBy('locale', 'asc')
            .execute();

        return rows.map(row => ({ locale: row.locale, name: row.name, direction: row.direction, madeFor: row.madeFor, importedAt: row.updatedAt }));
    }

    /** One language's pack, or `undefined` for a language this station has not got, which is a 404. */
    async get(locale: string): Promise<StoredLanguagePack | undefined> {
        const row = await this.db
            .selectFrom('deadair.consoleLanguages')
            .select(['locale', 'name', 'direction', 'madeFor', 'updatedAt', 'catalog'])
            .where('stationKey', '=', this.station.stationKey)
            .where('locale', '=', locale)
            .executeTakeFirst();

        if (row === undefined) return undefined;
        return {
            locale: row.locale,
            name: row.name,
            direction: row.direction,
            madeFor: row.madeFor,
            importedAt: row.updatedAt,
            // Postgres hands back what went in, and what went in was checked to be an object on the
            // way; anything else is read as an empty catalog, which a console shows as English.
            catalog:
                row.catalog !== null && typeof row.catalog === 'object' && !Array.isArray(row.catalog)
                    ? (row.catalog as Record<string, unknown>)
                    : {},
        };
    }

    /** Installs a language, replacing whatever pack this station held for it. */
    async put(draft: LanguageDraft): Promise<void> {
        const columns = {
            name: draft.name,
            direction: draft.direction,
            madeFor: draft.madeFor,
            catalog: sql<string>`${JSON.stringify(draft.catalog)}::jsonb`,
            importedBy: draft.importedBy ?? null,
        };

        await this.db
            .insertInto('deadair.consoleLanguages')
            .values({ stationKey: this.station.stationKey, locale: draft.locale, ...columns })
            .onConflict(oc => oc.columns(['stationKey', 'locale']).doUpdateSet(columns))
            .execute();
    }

    /** Answers whether there was anything to remove. */
    async remove(locale: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.consoleLanguages')
            .where('stationKey', '=', this.station.stationKey)
            .where('locale', '=', locale)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }
}
