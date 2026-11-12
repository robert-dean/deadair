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

/**
 * Which pass has been over a document, which is a WIDER question than which one wrote a claim.
 *
 * `gloss` produces no fact at all — it fills `deadair.pronunciations` out of the pronunciation key
 * an article printed for its own name — and is marked here anyway, because what a mark answers is
 * "has this pass read this document" and a second table asking that would be this table under
 * another name. The two vocabularies are deliberately not one type: a value that can be written to
 * `facts.source` is a claim's author, and `gloss` is never that.
 */
export type DocumentPass = FactSource | 'gloss';

/**
 * What sort of fact a claim is.
 *
 * The same list as the `facts_category_check` constraint, and the reason it is
 * a runtime array rather than only a type is that the extraction prompt reads
 * it: a category the model is told about but the column refuses would be a row
 * that fails to insert, and a category the column allows but nothing describes
 * is one the model will never produce.
 */
export const FACT_CATEGORIES = ['summary', 'placement', 'chart', 'recording', 'personnel', 'controversy', 'cover_or_sample', 'ending'] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** What a claim is about: one level, one id. */
export interface FactSubject {
    type: FactSubjectType;
    id: string;
}

/** A document that has not been read by this extractor yet, with the subject it describes. */
export interface PendingDocument {
    subject: FactSubject;
    /**
     * What the CATALOG calls this subject, and its artist where it has one.
     *
     * Carried from the row rather than taken from `title` below, which is the
     * ARTICLE's name and is not the same thing: an encyclopaedia files a band
     * under "Portishead (band)" and a song under whatever disambiguator it
     * needed. An extractor told to read about "Portishead (band)" is being told
     * something slightly untrue about the record it is describing.
     */
    name: string;
    artist?: string;
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

/**
 * A claim as the break writer wants it: the sentence, and the id to stamp when it is used.
 *
 * Everything the console reads — the citation, the quote, the category, which extractor found it —
 * is deliberately absent. A writer wants something to say and has no use for the rest, and the
 * provenance stays where somebody can act on it.
 */
export interface ClaimForTrack {
    id: string;
    claim: string;
    /**
     * Which of the three things this claim is about.
     *
     * The one piece of provenance a writer does get, and only because a reader spreading its budget
     * across the recording, its record and whoever made it has to know which is which. It was already
     * the query's sort key; this hands it over rather than throwing it away.
     */
    level: FactSubjectType;
}

/**
 * A claim offered to a break whose whole subject is the claim, with what it is about.
 *
 * {@link ClaimForTrack}'s sibling for the trivia break, and the difference is the NAME. A talk break's
 * claim arrives beside the record it is about, so the writer already knows the subject; a trivia
 * break's arrives on its own, about a record that may not be anywhere near the running order, and a
 * presenter handed "It was recorded in a single afternoon" with no subject has nothing to say.
 */
export interface TriviaClaim {
    id: string;
    claim: string;
    level: FactSubjectType;
    /** The catalog's own name for the subject: a track's title, an album's name, an artist's name. */
    name: string;
    /** Whoever made it, for a track or an album. Absent for an artist, who is the subject already. */
    artist?: string;
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
    async listPendingDocuments(source: DocumentPass, limit: number): Promise<PendingDocument[]> {
        const rows = await sql<{
            subjectType: FactSubjectType;
            subjectId: string;
            name: string;
            artist: string | null;
            provider: string;
            url: string | null;
            title: string | null;
            text: string | null;
        }>`
            select 'track' as subject_type,
                   t.id as subject_id,
                   t.title as name,
                   ar.name as artist,
                   te.provider,
                   d.doc->>'url' as url,
                   d.doc->>'title' as title,
                   d.doc->>'text' as text
              from deadair.tracks t
              join deadair.artists ar on ar.id = t.artist_id
              join deadair.track_enrichment te on te.track_id = t.id
              cross join lateral jsonb_array_elements(coalesce(te.data->'documents', '[]'::jsonb)) as d(doc)
             where t.merged_into_id is null
               and not exists (select 1
                                 from deadair.fact_extractions fe
                                where fe.track_id = t.id
                                  and fe.source = ${source}
                                  and fe.document_url = d.doc->>'url')
            union all
            select 'album', al.id, al.name, ar.name, ale.provider, d.doc->>'url', d.doc->>'title', d.doc->>'text'
              from deadair.albums al
              join deadair.artists ar on ar.id = al.artist_id
              join deadair.album_enrichment ale on ale.album_id = al.id
              cross join lateral jsonb_array_elements(coalesce(ale.data->'documents', '[]'::jsonb)) as d(doc)
             where al.merged_into_id is null
               and not exists (select 1
                                 from deadair.fact_extractions fe
                                where fe.album_id = al.id
                                  and fe.source = ${source}
                                  and fe.document_url = d.doc->>'url')
            union all
            select 'artist', a.id, a.name, null, ae.provider, d.doc->>'url', d.doc->>'title', d.doc->>'text'
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
                name: row.name,
                ...(nullable(row.artist) === undefined ? {} : { artist: row.artist! }),
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
    async recordExtraction(document: PendingDocument, source: DocumentPass, claims: FactWrite[]): Promise<number> {
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
     * A document read by a pass that writes something other than a claim.
     *
     * The mark alone, and `yielded` keeps the column meaning what it says: how much this document
     * was worth to this pass, where zero is the interesting value and the reason the table exists.
     *
     * Separate from {@link recordExtraction} rather than a parameter of it, because that one's whole
     * job is landing the claims and the mark in ONE transaction and there are no claims here. A
     * caller that writes elsewhere first and marks second is choosing to re-read a document after a
     * crash rather than to lose what it found, which is the right way round when the writer it
     * marks for can tell a duplicate from a new entry.
     */
    async markRead(document: PendingDocument, source: DocumentPass, yielded: number): Promise<void> {
        await this.db
            .insertInto('deadair.factExtractions')
            .values({ ...subjectColumns(document.subject), source, documentUrl: document.url, claims: yielded })
            .onConflict(conflict => conflict.doNothing())
            .execute();
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
     * The claims worth saying about some records right now, keyed by track id.
     *
     * Three arms again, and the ordering is the whole answer. `level` puts what is known about this
     * recording ahead of what is known about its record, ahead of what is known about whoever made
     * it — the same preference the provider facts have always been read in. Within a level it is
     * coldest first, so a claim nothing has ever said outranks one said last week, and the index
     * carries that ordering rather than the query sorting for it.
     *
     * The cooldown is applied HERE rather than by the caller, because it belongs with the ordering:
     * a fact resting is not a fact ranked low, it is a fact that must not be offered at all, and a
     * caller that read them and filtered afterwards would come up short exactly when the store was
     * thin.
     */
    async findFactsForTracks(trackIds: readonly string[], cooldownMs: number): Promise<Map<string, ClaimForTrack[]>> {
        const found = new Map<string, ClaimForTrack[]>();
        if (trackIds.length === 0) return found;

        const ids = [...new Set(trackIds)];
        const cooldownSeconds = Math.max(0, Math.round(cooldownMs / 1000));

        const rows = await sql<{ trackId: string; factId: string; claim: string; level: number }>`
            with rested as (
                select f.*
                  from deadair.facts f
                 where f.last_used_at is null
                    or f.last_used_at < now() - make_interval(secs => ${cooldownSeconds})
            )
            select t.id as track_id, f.id as fact_id, f.claim, 0 as level, f.last_used_at
              from deadair.tracks t
              join rested f on f.track_id = t.id
             where t.id = any(${ids}::uuid[]) and t.merged_into_id is null
            union all
            select t.id, f.id, f.claim, 1, f.last_used_at
              from deadair.tracks t
              join deadair.albums al on al.id = t.album_id and al.merged_into_id is null
              join rested f on f.album_id = al.id
             where t.id = any(${ids}::uuid[]) and t.merged_into_id is null
            union all
            select t.id, f.id, f.claim, 2, f.last_used_at
              from deadair.tracks t
              join deadair.artists a on a.id = t.artist_id and a.merged_into_id is null
              join rested f on f.artist_id = a.id
             where t.id = any(${ids}::uuid[]) and t.merged_into_id is null
             order by track_id, level, last_used_at asc nulls first, fact_id
        `.execute(this.db);

        for (const row of rows.rows) {
            const claims = found.get(row.trackId) ?? [];
            claims.push({ id: row.factId, claim: row.claim, level: FACT_SUBJECTS[row.level] ?? 'artist' });
            found.set(row.trackId, claims);
        }

        return found;
    }

    /**
     * Claims worth a break of their own, from anywhere in the music this station has played.
     *
     * The trivia break's substrate. `findFactsForTracks` asks about the two records either side of a
     * link; this asks about everything the station has ever put on air, because a trivia break is
     * about a record that is NOT necessarily playing. Three things narrow it, and each is a question
     * about what the station should be heard saying rather than about what is true.
     *
     * - **Played, not merely held.** A subject qualifies through a track in `play_history`. A library
     *   can hold a provider's whole catalogue, and a trivia break about an artist this station has never
     *   played is a fact about somebody else's radio station.
     * - **Not kept off air.** A track, record or artist the operator disliked (`rating < 0`) or has
     *   suspended is left out, so the station does not bring up in conversation what it has been told
     *   not to play.
     * - **Rested.** The same cooldown the talk break applies, inside the query for its reason: a
     *   resting claim is not one ranked low, it is one that must not be offered at all.
     *
     * The order prefers anything but a `summary`, since an article's opening sentence ("X is an English
     * band formed in Bristol") is true and is not trivia; a station whose store holds only summaries
     * still gets them. Then coldest first, then RANDOM, because a store with hundreds of never-said
     * claims would otherwise hand over the same oldest six every time and the spread across the
     * library is the point of the kind.
     *
     * `maxChars` drops a claim too long to say as one, `MAX_FACT_CHARS`'s rule for the talk break.
     */
    async findTrivia(cooldownMs: number, limit: number, maxChars: number): Promise<TriviaClaim[]> {
        if (limit <= 0) return [];
        const cooldownSeconds = Math.max(0, Math.round(cooldownMs / 1000));

        const rows = await sql<{ factId: string; claim: string; level: number; name: string; artist: string | null }>`
            with heard as (
                select distinct t.id as track_id, t.album_id, t.artist_id
                  from deadair.play_history ph
                  join deadair.tracks t on t.id = ph.track_id
                 where t.merged_into_id is null
                   and t.rating >= 0
                   and (t.suspended_until is null or t.suspended_until <= now())
            ),
            candidates as (
                select f.id as fact_id, f.claim, f.category, f.last_used_at, 0 as level, t.title as name, ar.name as artist
                  from deadair.facts f
                  join deadair.tracks t on t.id = f.track_id
                  join deadair.artists ar on ar.id = t.artist_id
                 where f.track_id in (select track_id from heard)
                   and ar.rating >= 0 and (ar.suspended_until is null or ar.suspended_until <= now())
                union all
                select f.id, f.claim, f.category, f.last_used_at, 1, al.name, ar.name
                  from deadair.facts f
                  join deadair.albums al on al.id = f.album_id and al.merged_into_id is null
                  join deadair.artists ar on ar.id = al.artist_id
                 where f.album_id in (select album_id from heard where album_id is not null)
                   and al.rating >= 0 and (al.suspended_until is null or al.suspended_until <= now())
                   and ar.rating >= 0 and (ar.suspended_until is null or ar.suspended_until <= now())
                union all
                select f.id, f.claim, f.category, f.last_used_at, 2, a.name, null
                  from deadair.facts f
                  join deadair.artists a on a.id = f.artist_id and a.merged_into_id is null
                 where f.artist_id in (select artist_id from heard)
                   and a.rating >= 0 and (a.suspended_until is null or a.suspended_until <= now())
            )
            select fact_id, claim, level, name, artist
              from candidates
             where (last_used_at is null or last_used_at < now() - make_interval(secs => ${cooldownSeconds}))
               and length(claim) <= ${maxChars}
             order by (category = 'summary'), last_used_at asc nulls first, random()
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => ({
            id: row.factId,
            claim: row.claim,
            level: FACT_SUBJECTS[row.level] ?? 'artist',
            name: row.name,
            ...(nullable(row.artist) === undefined ? {} : { artist: row.artist! }),
        }));
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
