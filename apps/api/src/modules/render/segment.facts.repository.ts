import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';

/** A stored claim a break was handed, as the write job knows it. */
export interface SegmentFactWrite {
    factId: string;
    /** The sentence as the writer was handed it. */
    claim: string;
    /** Whether the written words said it, as the station read them back. See `mentionsFact`. */
    told: boolean;
}

/** One of a break's sources, as it stood when the break was written. */
export interface SegmentSource {
    /** Absent once the claim itself has gone with its record. The rest of the row outlives it. */
    factId?: string;
    claim: string;
    sourceUrl: string;
    sourceQuote: string;
    sourceProvider: string;
    told: boolean;
}

/**
 * Which stored claims a written break was handed, with where each came from.
 *
 * The other half of `deadair.facts`' evidence rule: a claim is kept with the span of the article that
 * states it, and this keeps which break it went into, so a listener's "where did the host get that"
 * has an answer. Keyed on the segment, which is what airs. See migration `0124_segment_facts.sql`.
 *
 * ## One set per segment, because a rewrite is not a second break
 *
 * {@link replaceForSegment} is the only write, and it clears whatever the last write of the break left
 * INCLUDING when this one was handed nothing, on `PersonaTellingRepository`'s reason: segments are
 * reopened and rewritten constantly, and a rewrite that carries no claim must not keep showing the
 * last one's sources.
 */
@Injectable()
export class SegmentFactsRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly station: StationIdentity,
    ) {
        super(db);
    }

    /**
     * Replace a break's sources with the claims this write of it was handed.
     *
     * The source columns are copied off `deadair.facts` here rather than handed in, so nothing a caller
     * passes can put a URL beside a claim the store does not hold. A claim that has gone since it was
     * read (its record deleted mid-write) has no source to copy and is left out, which is the store's
     * own `not null` rule applied a moment later.
     */
    async replaceForSegment(segmentId: string, handed: readonly SegmentFactWrite[]): Promise<void> {
        await this.db
            .deleteFrom('deadair.segmentFacts')
            .where('stationKey', '=', this.station.stationKey)
            .where('segmentId', '=', segmentId)
            .execute();

        if (handed.length === 0) return;

        const sources = await this.db
            .selectFrom('deadair.facts')
            .select(['id', 'sourceUrl', 'sourceQuote', 'sourceProvider'])
            .where('stationKey', '=', this.station.stationKey)
            .where(
                'id',
                'in',
                handed.map(fact => fact.factId),
            )
            .execute();
        const byId = new Map(sources.map(source => [source.id, source]));

        // Once per claim, whatever the caller handed: the unique index would refuse a second.
        const rows = [...new Map(handed.map(fact => [fact.factId, fact])).values()].flatMap(fact => {
            const source = byId.get(fact.factId);
            return source === undefined
                ? []
                : [
                      {
                          stationKey: this.station.stationKey,
                          segmentId,
                          factId: fact.factId,
                          claim: fact.claim,
                          sourceUrl: source.sourceUrl,
                          sourceQuote: source.sourceQuote,
                          sourceProvider: source.sourceProvider,
                          told: fact.told,
                      },
                  ];
        });
        if (rows.length === 0) return;

        await this.db.insertInto('deadair.segmentFacts').values(rows).execute();
    }

    /** A break's sources, the ones it said first. */
    async forSegment(segmentId: string): Promise<SegmentSource[]> {
        const rows = await this.db
            .selectFrom('deadair.segmentFacts')
            .select(['factId', 'claim', 'sourceUrl', 'sourceQuote', 'sourceProvider', 'told'])
            .where('stationKey', '=', this.station.stationKey)
            .where('segmentId', '=', segmentId)
            .orderBy('told', 'desc')
            .orderBy('createdAt')
            .orderBy('id')
            .execute();

        // `== null` for the driver's reason. See `apps/api/CLAUDE.md` § "Reading and writing the database".
        return rows.map(({ factId, ...row }) => (factId == null ? row : { ...row, factId }));
    }
}
