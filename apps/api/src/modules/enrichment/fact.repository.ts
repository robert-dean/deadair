import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '../data/data.repository.js';

/**
 * `null` in, `undefined` out.
 *
 * File-local, the way the same one-liner is in `enrichment.repository.ts`. It
 * takes both because a driver read answers `undefined` for a SQL NULL while the
 * generated types say `T | null`, so `== null` is the only comparison that is
 * true of what actually arrives.
 */
const nullable = <T>(value: T | null | undefined): T | undefined => (value == null ? undefined : value);

/**
 * Which of the three things a claim can be about.
 *
 * The same three levels the enrichment walk asks about and the same three the
 * break writer reads back, in the same order of preference: what is known about
 * this recording, then about its record, then about whoever made it.
 */
export const FACT_SUBJECTS = ['track', 'album', 'artist'] as const;

export type FactSubjectType = (typeof FACT_SUBJECTS)[number];

/** Which extractor produced a claim. See `0015_facts.sql` for why the two are tracked apart. */
export type FactSource = 'lead' | 'model';

export type FactCategory = 'summary' | 'placement' | 'chart' | 'recording' | 'personnel' | 'controversy' | 'cover_or_sample' | 'ending';

/** What a claim is about: one level, one id. */
export interface FactSubject {
    type: FactSubjectType;
    id: string;
}

/** A document that has not been read by this extractor yet, with the subject it describes. */
export interface PendingDocument {
    subject: FactSubject;
    /** The enrichment plugin that handed the document over. */
    provider: string;
    url: string;
    title: string;
    text: string;
}

/** A claim on its way into the store. */
export interface FactWrite {
    subject: FactSubject;
    claim: string;
    category: FactCategory;
    source: FactSource;
    sourceProvider: string;
    sourceUrl: string;
    sourceQuote: string;
    confidence?: number;
    model?: string;
}

/** A claim on its way out, as the reader wants it. */
export interface StoredFact {
    id: string;
    subject: FactSubject;
    claim: string;
    category: FactCategory;
    source: FactSource;
    sourceProvider: string;
    sourceUrl: string;
    sourceQuote: string;
    confidence?: number;
    model?: string;
    lastUsedAt?: string;
}

/** The column each subject level lives in, so a level is named once rather than in every statement. */
const COLUMN: Record<FactSubjectType, 'trackId' | 'albumId' | 'artistId'> = {
    track: 'trackId',
    album: 'albumId',
    artist: 'artistId',
};

/** The three subject columns as one object, with the level that applies set and the other two null. */
const subjectColumns = (subject: FactSubject): { trackId: string | null; albumId: string | null; artistId: string | null } => ({
    trackId: subject.type === 'track' ? subject.id : null,
    albumId: subject.type === 'album' ? subject.id : null,
    artistId: subject.type === 'artist' ? subject.id : null,
});

/**
 * The fact store: claims the host extracted, and the record of which documents
 * it has already read.
 *
 * Separate from `EnrichmentRepository` because the two hold different kinds of
 * thing. That one stores what a PLUGIN said, verbatim and per provider, and
 * re-reads it through the same sanitizer every time. This one stores what this
 * host CONCLUDED, with the span of somebody else's prose that supports each
 * conclusion. A plugin's payload is an answer; a fact is an argument, and it
 * keeps its evidence.
 */
@Injectable()
export class FactRepository extends DataRepository {
    /**
     * Documents no extraction of this kind has read yet, across all three
     * levels.
     *
     * One query with three arms rather than three queries, and the `not exists`
     * sits INSIDE each arm rather than over the union — the same shape the
     * activity feed uses, and for the same reason: filtered inside, each arm can
     * use its own partial index; filtered outside, the whole union materialises
     * first and every article on the install is unnested before anything is
     * discarded.
     *
     * Raw SQL because the interesting part is `jsonb_array_elements` over a
     * payload column, which the query builder does not express at all.
     */
    async listPendingDocuments(source: FactSource, limit: number): Promise<PendingDocument[]> {
        const rows = await sql<{
            subjectType: FactSubjectType;
            subjectId: string;
            provider: string;
            url: string | null;
            title: string | null;
            text: string | null;
        }>`
            select 'track' as subject_type,
                   t.id as subject_id,
                   te.provider,
                   d.doc->>'url' as url,
                   d.doc->>'title' as title,
                   d.doc->>'text' as text
              from deadair.tracks t
              join deadair.track_enrichment te on te.track_id = t.id
              cross join lateral jsonb_array_elements(coalesce(te.data->'documents', '[]'::jsonb)) as d(doc)
             where t.merged_into_id is null
               and not exists (select 1
                                 from deadair.fact_extractions fe
                                where fe.track_id = t.id
                                  and fe.source = ${source}
                                  and fe.document_url = d.doc->>'url')
            union all
            select 'album', al.id, ale.provider, d.doc->>'url', d.doc->>'title', d.doc->>'text'
              from deadair.albums al
              join deadair.album_enrichment ale on ale.album_id = al.id
              cross join lateral jsonb_array_elements(coalesce(ale.data->'documents', '[]'::jsonb)) as d(doc)
             where al.merged_into_id is null
               and not exists (select 1
                                 from deadair.fact_extractions fe
                                where fe.album_id = al.id
                                  and fe.source = ${source}
                                  and fe.document_url = d.doc->>'url')
            union all
            select 'artist', a.id, ae.provider, d.doc->>'url', d.doc->>'title', d.doc->>'text'
              from deadair.artists a
              join deadair.artist_enrichment ae on ae.artist_id = a.id
              cross join lateral jsonb_array_elements(coalesce(ae.data->'documents', '[]'::jsonb)) as d(doc)
             where a.merged_into_id is null
               and not exists (select 1
                                 from deadair.fact_extractions fe
                                where fe.artist_id = a.id
                                  and fe.source = ${source}
                                  and fe.document_url = d.doc->>'url')
             limit ${limit}
        `.execute(this.db);

        // A document missing any of the three is one the sanitizer would never
        // have stored, so it is a row edited by hand or by something that
        // bypassed the write path. Skipped rather than trusted.
        return rows.rows
            .filter(row => row.url !== null && row.title !== null && row.text !== null)
            .map(row => ({
                subject: { type: row.subjectType, id: row.subjectId },
                provider: row.provider,
                url: row.url!,
                title: row.title!,
                text: row.text!,
            }));
    }

    /**
     * Everything one extraction produced, plus the mark saying it happened, in
     * one transaction.
     *
     * The two have to land together. A mark with no claims is a document
     * recorded as read that was never read, and claims with no mark are a
     * document that is read again on every pass forever — and for the model
     * pass that is the station's one model slot, spent on the same article for
     * the life of the install.
     *
     * Claims collide on the unique index whenever the same article is read
     * twice under two sources, or a model repeats what the lead sentence
     * already said. That is expected rather than exceptional, so it is ignored
     * rather than caught: the row that is already there is the same claim.
     */
    async recordExtraction(document: PendingDocument, source: FactSource, claims: FactWrite[]): Promise<number> {
        return await this.db.transaction().execute(async trx => {
            let written = 0;

            if (claims.length > 0) {
                const inserted = await trx
                    .insertInto('deadair.facts')
                    .values(
                        claims.map(fact => ({
                            ...subjectColumns(fact.subject),
                            claim: fact.claim,
                            category: fact.category,
                            source: fact.source,
                            sourceProvider: fact.sourceProvider,
                            sourceUrl: fact.sourceUrl,
                            sourceQuote: fact.sourceQuote,
                            confidence: fact.confidence ?? null,
                            model: fact.model ?? null,
                        })),
                    )
                    .onConflict(conflict => conflict.doNothing())
                    .returning('id')
                    .execute();

                written = inserted.length;
            }

            await trx
                .insertInto('deadair.factExtractions')
                .values({ ...subjectColumns(document.subject), source, documentUrl: document.url, claims: written })
                .onConflict(conflict => conflict.doNothing())
                .execute();

            return written;
        });
    }

    /**
     * Every claim about one set of subjects, coldest first.
     *
     * Ordered by `last_used_at` with nulls first, which is the order the
     * cooldown wants: a fact that has never been said outranks one that was
     * said last week, and the index carries that ordering so nothing is sorted
     * at read time.
     */
    async findFacts(subjects: readonly FactSubject[]): Promise<StoredFact[]> {
        if (subjects.length === 0) return [];

        const idsFor = (type: FactSubjectType): string[] => [...new Set(subjects.filter(s => s.type === type).map(s => s.id))];

        const found = await Promise.all(
            FACT_SUBJECTS.map(async type => {
                const ids = idsFor(type);
                if (ids.length === 0) return [];

                const rows = await this.db
                    .selectFrom('deadair.facts')
                    .where(COLUMN[type], 'in', ids)
                    .orderBy('lastUsedAt', order => order.asc().nullsFirst())
                    .orderBy('createdAt', 'asc')
                    .selectAll()
                    .execute();

                return rows.map(row => ({
                    id: row.id,
                    subject: { type, id: row[COLUMN[type]]! },
                    claim: row.claim,
                    category: row.category,
                    source: row.source,
                    sourceProvider: row.sourceProvider,
                    sourceUrl: row.sourceUrl,
                    sourceQuote: row.sourceQuote,
                    confidence: nullable(row.confidence),
                    model: nullable(row.model),
                    lastUsedAt: nullable(row.lastUsedAt)?.toISO() ?? undefined,
                }));
            }),
        );

        return found.flat();
    }

    /**
     * Marks facts as used, so the cooldown can keep them apart.
     *
     * Best-effort by contract: the one caller `void`s it, because a fact is
     * what makes a break better and never what makes it possible.
     */
    async markUsed(ids: readonly string[]): Promise<void> {
        if (ids.length === 0) return;

        await this.db
            .updateTable('deadair.facts')
            .set({ lastUsedAt: sql`now()` })
            .where('id', 'in', [...ids])
            .execute();
    }
}
