import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { AlbumEnrichmentDetail, ArtistEnrichmentDetail, TrackEnrichmentDetail } from '#src/modules/catalog/types/catalog.types.js';
import {
    forTheWire,
    mergeAlbumEnrichment,
    mergeArtistEnrichment,
    mergeEnrichment,
    sanitizeAlbumEnrichment,
    sanitizeArtistEnrichment,
    sanitizeEnrichment,
} from './enrichment.merge.js';
import { EnrichmentRepository, type FactPayload, type StoredProviderPayload } from './enrichment.repository.js';
import { EnrichmentService } from './enrichment.service.js';
import { FactRepository, type FactSubjectType, type StoredFact } from './fact.repository.js';

/**
 * How many facts one record contributes to a talk break.
 *
 * A break is one sentence of about forty words (`DEFAULT_MAX_WORDS`), and it usually sits between
 * two records — so two each is already four lines of notes for a model that will use one of them.
 * The cost of more is not the tokens, it is the wait: the model writer gives up after
 * `MAX_WAIT_MS` and lets the station's own phrasings write instead, and a longer prompt is a
 * slower answer.
 */
export const MAX_BREAK_FACTS = 2;

/**
 * How long a fact may be before it is dropped rather than trimmed.
 *
 * The same rule the MusicBrainz plugin writes them under: half a sentence is worse than no
 * sentence when the thing on the other end is a mouth. The sanitizer's own cap is 2,000
 * characters, which is a bound on what may be STORED and far too long to put in front of a model.
 */
export const MAX_FACT_CHARS = 200;

/**
 * How long a claim rests after the station has used it.
 *
 * A week, which on a rotation of a few hundred artists means a listener hears a given line about a
 * given record at most once in a listening habit. Long enough to be worth having, short enough that
 * a small store does not run dry — and when every claim about a record IS resting, nothing breaks:
 * the provider facts fill in, and then the writers' own phrasings, which say nothing about the
 * record at all.
 *
 * There is deliberately no retirement beside it. A fact that has been said fifty times is still
 * true, and a station whose good lines expired permanently would end up with less to say the longer
 * it ran.
 */
export const FACT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Live plugin priority, with anything no longer installed sorting last rather than being dropped.
 *
 * Shared by the console read and the fact read so the two cannot rank the same two payloads
 * differently.
 */
const byProviderRank = (order: string[]) => {
    const rank = new Map(order.map((provider, index) => [provider, index]));
    return (left: { provider: string }, right: { provider: string }): number =>
        (rank.get(left.provider) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.provider) ?? Number.MAX_SAFE_INTEGER) ||
        left.provider.localeCompare(right.provider);
};

/**
 * Which of a record's facts this particular break gets.
 *
 * The list arrives in preference order (the recording's own facts, then its record's, then its
 * artist's) and this decides where in that order to start. **The rotation is what stops a station
 * saying the same sentence about the same artist every time they come round**, and it is a
 * caller's number rather than a clock or a random so that the whole function stays pinnable by a
 * test.
 *
 * Nothing here has to fill the budget. A record with one usable fact contributes one, and a record
 * whose only fact was too long to say contributes none, which is an ordinary outcome rather than a
 * gap to pad — the writers all have phrasings that say nothing about the record at all.
 */
export function chooseFacts(facts: readonly string[], rotate = 0): string[] {
    const kept: string[] = [];
    const seen = new Set<string>();

    for (const fact of facts) {
        const line = fact.trim();
        // Whole facts only. A fact this long is a biography that arrived in the wrong field.
        if (line.length === 0 || line.length > MAX_FACT_CHARS) continue;

        const marker = line.toLowerCase();
        if (seen.has(marker)) continue;
        seen.add(marker);
        kept.push(line);
    }

    if (kept.length === 0) return [];

    const from = ((rotate % kept.length) + kept.length) % kept.length;
    return [...kept.slice(from), ...kept.slice(0, from)].slice(0, MAX_BREAK_FACTS);
}

/**
 * One stored payload once it has been sanitized, before it is shaped for the wire.
 *
 * The timestamps stay `DateTime`: the contract's `datetime` is a luxon instant on
 * this side of the wire and an ISO string on the client's, so there is nothing to
 * convert here.
 */
interface ReadSource<T> {
    provider: string;
    providerRef?: string;
    fetchedAt: DateTime;
    expiresAt?: DateTime;
    stale: boolean;
    found: boolean;
    data: T;
}

/**
 * Reading back what the enrichment walk stored.
 *
 * Separate from {@link EnrichmentService} because the two have nothing in
 * common but a table: that one spends rate-limited requests against upstreams
 * and writes, this one answers a request from rows that already exist. Keeping
 * them apart is what lets the console read a track's enrichment without any
 * risk of a page view triggering a fan-out.
 *
 * What it does share is the interpretation. Payloads are re-sanitized and
 * re-merged with the same functions the write path used, in the same live
 * plugin-priority order, so the console cannot end up telling a different story
 * from the one promotion told the canonical columns.
 *
 * Its second caller is not the console at all: {@link factsForTracks} is what
 * puts a sentence about a record in front of the model that writes the talk
 * break. It is here rather than in `director/` for exactly the reason above —
 * a second reader of these tables is fine, and a second *interpretation* of
 * them is how the station ends up saying something the console denies.
 */
@Injectable()
export class EnrichmentReadService {
    constructor(
        private readonly enrichmentRepository: EnrichmentRepository,
        private readonly enrichmentService: EnrichmentService,
        private readonly factRepository: FactRepository,
    ) {}

    /** @throws 404 when no such track exists, and equally when it was merged into another. */
    async getTrackEnrichment(id: string): Promise<TrackEnrichmentDetail> {
        const stored = await this.enrichmentRepository.findTrackEnrichment(id);
        if (stored === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });

        const sources = this.read(stored, this.enrichmentService.providerIds(), sanitizeEnrichment);
        const merged = mergeEnrichment(sources.filter(source => source.found).map(source => source.data));

        return parseAndValidate({ trackId: id, merged, sources, claims: await this.claimsFor('track', id) }, TrackEnrichmentDetail);
    }

    /** @throws 404 when no such artist exists, and equally when they were merged into another. */
    async getArtistEnrichment(id: string): Promise<ArtistEnrichmentDetail> {
        const stored = await this.enrichmentRepository.findArtistEnrichment(id);
        if (stored === undefined) throw httpError(404).withDetails({ message: `artist "${id}" is not in the catalog` });

        const sources = this.read(stored, this.enrichmentService.artistProviderIds(), sanitizeArtistEnrichment);
        const merged = mergeArtistEnrichment(sources.filter(source => source.found).map(source => source.data));

        return parseAndValidate({ artistId: id, merged, sources, claims: await this.claimsFor('artist', id) }, ArtistEnrichmentDetail);
    }

    /** @throws 404 when no such album exists, and equally when it was merged into another. */
    async getAlbumEnrichment(id: string): Promise<AlbumEnrichmentDetail> {
        const stored = await this.enrichmentRepository.findAlbumEnrichment(id);
        if (stored === undefined) throw httpError(404).withDetails({ message: `album "${id}" is not in the catalog` });

        const sources = this.read(stored, this.enrichmentService.albumProviderIds(), sanitizeAlbumEnrichment);
        const merged = mergeAlbumEnrichment(sources.filter(source => source.found).map(source => source.data));

        return parseAndValidate({ albumId: id, merged, sources, claims: await this.claimsFor('album', id) }, AlbumEnrichmentDetail);
    }

    /**
     * What the station BELIEVES about this thing, as opposed to what a provider said about it.
     *
     * A plain read of rows that already exist, which is the same promise the rest of this service
     * makes: a page view must never be able to start work. It is on the detail response rather than
     * folded into `merged` because a claim is the host's own — extracted here, checked here, and
     * carrying the citation that makes it worth anything.
     *
     * The articles the claims were read out of are deliberately not here. `forTheWire` drops them
     * from every payload above, and a claim carries the one span of an article that matters.
     *
     * Shaped field by field rather than handed over whole. `subject` is on the stored row because
     * the store is keyed by it and is redundant on the wire — the response already says which track
     * this is — and the contract is a STRICT object, so passing it through fails the response's own
     * validation with `subject: Unrecognized key`. That is the same failure `forTheWire` exists to
     * prevent, arriving from the other direction.
     */
    private async claimsFor(type: FactSubjectType, id: string): Promise<Omit<StoredFact, 'subject'>[]> {
        const claims = await this.factRepository.findFacts([{ type, id }]);

        return claims.map(({ subject: _subject, ...claim }) => claim);
    }

    /**
     * The short true things the station knows about some records, keyed by track id.
     *
     * What a talk break is shown about the records it sits between. Everything the console read
     * above carries — provenance, staleness, the miss rows, the fields nothing has a name for — is
     * dropped here, because a writer wants sentences and has no use for the rest.
     *
     * Preference order is the recording's own facts, then its record's, then its artist's: what is
     * known about this take of this song beats what is known about the album it came on, which
     * beats what is known about whoever made it. Within a level it is the same live plugin
     * priority the console reads under, and the same sanitize-and-merge, so a fact this hands a
     * model is one the enrichment panel would show for the same track.
     *
     * `rotate` is variety, not paging. See {@link chooseFacts}.
     *
     * ## The claims come first, and they TOP UP rather than mix
     *
     * A claim the host extracted beats a line a plugin composed, because it carries the span of an
     * article that says so and somebody can go and check it. So the claims are taken first, in the
     * order the store hands them over, and the provider facts fill whatever is left — the same
     * top-up shape `SetGeneratorChain` uses, rather than pooling the two and rotating over the lot,
     * which would put a template sentence in front of a sourced one at random.
     *
     * The two halves get their variety from different places, which is why they are not pooled.
     * A claim's is the cooldown, applied in the query: one that has been said is not offered again
     * for a week. A provider fact has no such record, so `rotate` is all it has.
     *
     * Every claim handed over is STAMPED, best-effort. See {@link FactRepository.markUsed} and the
     * note on `facts.last_used_at`: the stamp is at selection rather than at airing, because a
     * break can still be dropped before its slot, and a reader of `segment_events` is a great deal
     * of machinery for the difference between "used" and "used and heard".
     *
     * Only tracks with something to say appear in the answer. Absent is the ordinary case: on a
     * fresh install nothing has been enriched at all, and a station with no facts talks perfectly
     * well.
     */
    async factsForTracks(trackIds: readonly string[], rotate = 0): Promise<Map<string, string[]>> {
        const facts = new Map<string, string[]>();
        if (trackIds.length === 0) return facts;

        const ids = [...new Set(trackIds)];
        const [stored, claims] = await Promise.all([
            this.enrichmentRepository.findFactPayloadsForTracks(ids),
            this.factRepository.findFactsForTracks(ids, FACT_COOLDOWN_MS),
        ]);

        const used: string[] = [];

        for (const trackId of ids) {
            const believed = (claims.get(trackId) ?? []).slice(0, MAX_BREAK_FACTS);
            used.push(...believed.map(claim => claim.id));

            const chosen = [...believed.map(claim => claim.claim)];
            const row = stored.find(payloads => payloads.trackId === trackId);

            if (chosen.length < MAX_BREAK_FACTS && row !== undefined) {
                const supplied = chooseFacts(
                    [
                        ...(mergeEnrichment(this.ranked(row.track, this.enrichmentService.providerIds()).map(data => sanitizeEnrichment(data)))
                            .facts ?? []),
                        ...(mergeAlbumEnrichment(
                            this.ranked(row.album, this.enrichmentService.albumProviderIds()).map(data => sanitizeAlbumEnrichment(data)),
                        ).facts ?? []),
                        ...(mergeArtistEnrichment(
                            this.ranked(row.artist, this.enrichmentService.artistProviderIds()).map(data => sanitizeArtistEnrichment(data)),
                        ).facts ?? []),
                    ],
                    rotate,
                );

                for (const fact of supplied) {
                    if (chosen.length >= MAX_BREAK_FACTS) break;
                    if (!chosen.some(already => already.toLowerCase() === fact.toLowerCase())) chosen.push(fact);
                }
            }

            if (chosen.length > 0) facts.set(trackId, chosen);
        }

        // Deliberately not awaited into the answer's critical path, and deliberately caught: a
        // failed stamp costs a fact its rest, and nothing here may cost a break its notes.
        void this.factRepository.markUsed(used).catch(() => undefined);

        return facts;
    }

    /** One level's payloads in plugin-priority order, which is the order the merge has to see them in. */
    private ranked(payloads: FactPayload[], order: string[]): unknown[] {
        return [...payloads].sort(byProviderRank(order)).map(payload => payload.data);
    }

    /**
     * Stored rows to wire sources, in the order the merge has to see them.
     *
     * Sanitizing again on the way out is not defensive theatre. `data` is a
     * jsonb column with no constraint on it, the write path's sanitizer is the
     * only thing that has ever checked it, and a row edited by hand or by some
     * later writer would otherwise reach a browser as a link the console
     * renders for a human to click.
     *
     * Ordering is the live plugin priority, and a provider that is no longer
     * installed sorts last rather than being dropped. Its payload is still what
     * the station knows about this track, and the station's own columns were
     * promoted from it; hiding it would make the console disagree with them.
     * What it does not get is a say over a running provider.
     *
     * Some of what was stored does not go on the wire: `providerRef`, which the
     * contract carries on the source rather than inside `data`, and
     * `documents`, which is raw article text nothing here renders. See
     * {@link forTheWire}.
     */
    private read<T extends object>(stored: StoredProviderPayload[], order: string[], sanitize: (value: unknown) => T): ReadSource<T>[] {
        const now = DateTime.now();

        return stored
            .map(payload => {
                const clean = sanitize(payload.data);
                const data = forTheWire(clean);
                // What travels, plus the one thing that is deliberately kept
                // back: a source that answered with prose alone is a source
                // that answered, and calling it a recorded miss because the
                // wire drops its only field would have the console
                // contradicting the walk. A payload that is nothing but a
                // `providerRef` stays a miss, because that says nothing about
                // the record — which is the opposite case and why this is not
                // simply "did the plugin return anything".
                const documents = (clean as { documents?: unknown[] }).documents;
                const found = Object.keys(data).length > 0 || (documents?.length ?? 0) > 0;
                return {
                    provider: payload.provider,
                    providerRef: payload.providerRef,
                    fetchedAt: payload.fetchedAt,
                    expiresAt: payload.expiresAt,
                    // A row past its TTL is still the best answer there is. It
                    // is flagged rather than hidden, because "MusicBrainz said
                    // this in May and is due to be asked again" is a different
                    // thing from having nothing.
                    stale: payload.expiresAt !== undefined && payload.expiresAt <= now,
                    // An empty payload is a recorded miss: the provider was
                    // asked and had nothing. Not a failure, and not an empty
                    // card for the console to puzzle over.
                    found,
                    data,
                };
            })
            .sort(byProviderRank(order));
    }
}
