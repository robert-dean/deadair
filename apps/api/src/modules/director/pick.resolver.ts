import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AnalysisRepository } from '#modules/analysis/analysis.repository.js';
import { CatalogResolverService } from '#modules/catalog/ingest/catalog.resolver.service.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { advisoryPolicy, demandsClean } from './advisory.policy.js';
import { CandidatesRepository, bindsAnything, withinPeriod, type EraWindow } from './candidates.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { ProviderTrackLookup } from './provider.track.lookup.js';
import { artistKey, songKey } from './rotation.keys.js';
import { applyRules, rejectDisliked, spaceArtists, type ResolvedRules, type RotationCandidate } from './rotation.rules.js';
import type { TrackPick } from './set.generator.js';
import { measurementOf } from './track.measurement.js';
import { errorText } from '#modules/shared/error.text.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * Whether the station may play records it does not own yet.
 *
 * On by default, because off makes the whole lookup path inert and a station that has been asked
 * for heavy metal cannot have any if it may only draw from playlists somebody happened to sync. Off
 * is the switch for an operator who wants the library to be the boundary — nothing else changes,
 * and a pick outside it goes back to being dropped.
 */
export const DISCOVER_KEY = 'rotation.discover';
export const DISCOVER_DEFAULT = true;

/**
 * The fewest records one resolve may look up, however small the batch.
 *
 * Headroom for the ordinary case, where a station programming from its own library names one or two
 * records it turns out not to own. A batch smaller than this is never capped.
 */
export const MIN_DISCOVERIES = 8;

/**
 * The most records one resolve may look up, however large the batch.
 *
 * A bound on the network rather than on the answer. Every miss is a search across every searchable
 * provider, so a runaway batch would otherwise spend a provider's whole rate budget on one refill
 * and leave nothing for the next.
 *
 * Counted as ATTEMPTS rather than successes, since a search that found nothing cost the same round
 * trip as one that found something.
 */
export const MAX_DISCOVERIES = 32;

/**
 * How many lookups this batch gets: one per pick, held between the two bounds.
 *
 * It was a flat eight, which was sized for discovery as a garnish on an hour the library could
 * mostly fill — and that is precisely the case this path does NOT exist for. Give a briefed station
 * a theme its playlists have never covered and every pick in the batch needs a lookup, so a
 * twenty-four-pick refill spent its allowance a third of the way in and the rest were dropped as
 * "not in the catalog" without a single provider being asked about them. The symptom is
 * indistinguishable from a provider that carried nothing, which is why it is logged.
 *
 * Scaling with the batch is what makes the ceiling a runaway guard again rather than the thing that
 * decides how well a brief is served: an ordinary refill never comes near it, and an oversampled one
 * gets a lookup for every record it named.
 */
export const discoveryCap = (picks: number): number => Math.min(Math.max(picks, MIN_DISCOVERIES), MAX_DISCOVERIES);

/**
 * A pick that has been matched to a catalog row, carrying what the rules judge it by.
 *
 * The keys are computed once, here, through the same helpers `play_history` is written with, rather
 * than recomputed at each rule. A rotation rule that silently never matches has no symptom except a
 * station that repeats itself, so the fewer places these are derived the better.
 */
interface Identified extends RotationCandidate {
    pick: TrackPick;
    trackId: string;
    /**
     * The catalog's own title and lead artist for the track that was matched, which is what the
     * keys above were built from and what the item carries as its identity.
     *
     * Deliberately not the pick's own strings. A pick is what something ASKED for and the row is
     * what the station found, and where they differ it is the row that airs, is written to
     * `play_history` and is compared against on the next refill.
     */
    title: string;
    artist: string;
}

/** A resolved track with its keys still attached, so the last rule can be applied to it. */
type Airable = RundownTrack & RotationCandidate;

/** Drop the keys again. They are a rotation concern and a rundown item has no business carrying them. */
const toRundownTrack = ({ songKey: _song, artistKey: _artist, rating: _rating, ...track }: Airable): RundownTrack => track;

/**
 * Turning a chosen track into something the station can actually air.
 *
 * A pick names a work; a lineup item has to name a COPY, because that is what
 * the player is eventually handed — `pluginId` + `externalId`, which is the key
 * of `deadair.track_sources`. This is the step between, and it is where a pick
 * that nothing can play is dropped rather than becoming a gap on the mount.
 *
 * Three rungs:
 *
 *   1. The pick carries a canonical id (everything the catalog generator picks),
 *      or its title and artist match a catalog row.
 *   2. A provider has it under that exact name: it is ingested, becoming a real
 *      catalog row with a binding, and resolves like anything else from then on.
 *      See {@link ProviderTrackLookup}, and note the discovery is bounded per
 *      call and gated by `rotation.discover`.
 *   3. Neither: the pick is discarded and logged.
 *
 * Rung 2 is what makes "the provider's whole catalog" mean anything. The library
 * is filled by walking the connected account's playlists, so a station whose
 * playlists are ambient cannot match a metal record however well its provider
 * knows one — the pick was good, the copy exists, and it was being dropped for
 * want of a lookup. It ingests rather than airing straight from the provider
 * because the player fetches every record through `track_sources`, so a copy with
 * no binding has no URL; the row is the mechanism, not bookkeeping.
 *
 * The rules still run afterwards, and that ORDER is load-bearing rather than
 * incidental: a newly ingested track inherits whatever the operator already
 * thinks of its artist, so a record by a disliked act is dropped at rung 2's
 * expense rather than aired because nothing had an opinion about it yet.
 *
 * ## It is also where the rotation rules are enforced, and that is not tidiness
 *
 * The rules used to live inside `CatalogSetGenerator` alone, which was correct
 * exactly as long as it was the only generator. It is not: a {@link SetGenerator}
 * pick is a NAME, so any second binding — a model, an operator's request, a
 * plugin that programmes the station — hands over titles that nothing has judged.
 * A dislike is documented as an INSTRUCTION that no lineup may turn off, so a
 * generator able to route around it is a correctness hole rather than a matter of
 * taste.
 *
 * So the rules are applied HERE, at the one step every pick from every source
 * passes through on its way to becoming something airable. `CatalogSetGenerator`
 * still filters before its own draw and that is not redundant: filtering early is
 * what makes the draw efficient, and filtering here is what makes it guaranteed.
 * **Do not delete either one on the grounds that the other exists.**
 *
 * The one rule applied after the drops rather than before them is
 * {@link spaceArtists}, because spacing a batch and then removing two of its
 * tracks closes the gap back up. See {@link applyRules}.
 */
@Injectable()
export class PickResolver {
    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly tracks: TracksRepository,
        private readonly analysis: AnalysisRepository,
        private readonly history: PlayHistoryRepository,
        private readonly lookup: ProviderTrackLookup,
        private readonly ingest: CatalogResolverService,
        private readonly activity: ActivityRecorder,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Resolve a batch of picks, in order, dropping what cannot be played.
     *
     * Batched because the two lookups behind it are: one query for the bindings
     * and one for the display metadata, however many picks there are. A refill of
     * fifteen tracks costs the same as one.
     *
     * @param rules - The rules in force for the lineup these picks are for, which
     *   every pick is judged against here whatever chose it.
     * @param options.preference - Plugin ids in the operator's order, for a work several
     *   providers can serve.
     * @param options.era - The period this broadcast plays, when it was asked for one. Judged HERE
     *   for the reason everything else is: a pick is a NAME, so a generator that never read the
     *   catalog can hand over a record from the wrong decade and mean no harm by it.
     * @param options.avoidArtistKeys - Artists to drop outright, over whatever window the caller
     *   scoped it to — see `PlanRequest.avoidArtistKeys` for why that window is narrow.
     * @param options.seedArtistKey - The artist already at the tail of the order, so
     *   {@link spaceArtists} does not open this batch with them.
     */
    async resolve(
        picks: readonly TrackPick[],
        rules: ResolvedRules,
        options: { preference?: readonly string[]; era?: EraWindow; avoidArtistKeys?: ReadonlySet<string>; seedArtistKey?: string } = {},
    ): Promise<RundownTrack[]> {
        if (picks.length === 0) return [];

        const { preference = [], era, avoidArtistKeys, seedArtistKey } = options;
        const policy = advisoryPolicy(this.config);

        const identified = await this.identify(picks);
        if (identified.length === 0) return [];

        const eligible = await this.judge(identified, rules, era, avoidArtistKeys);
        if (eligible.length === 0) return [];

        const trackIds = eligible.map(entry => entry.trackId);
        // A third batch query alongside the two that were already here, so a refill of
        // fifteen tracks still costs three round trips rather than three per track.
        // `trustedAnalysisFor` has already dropped anything not worth acting on -- a
        // failure, a partial file, an older schema version -- so a miss here and an
        // unmeasured track are the same thing to the code below, which is the point.
        const [bindings, metadata, measured] = await Promise.all([
            // The advisory policy applies HERE, at the one step every pick from every generator
            // reaches, for exactly the reason the rotation rules do: a pick is a NAME, so a model
            // or an operator's request hands over records nothing has judged. Under `clean-only` a
            // work with no clean copy gets no binding and falls into the drop below, which is the
            // existing "nothing can play this" path rather than a second mechanism.
            this.candidates.bindingsFor(trackIds, preference, policy),
            this.tracks.findByIds(trackIds),
            this.analysis.trustedAnalysisFor(trackIds, ANALYSIS_SCHEMA_VERSION),
        ]);

        const resolved: Airable[] = [];
        for (const entry of eligible) {
            const { pick, trackId } = entry;
            const binding = bindings.get(trackId);
            if (!binding) {
                // Every provider that carried it has stopped, OR the station is clean-only and no
                // copy is positively marked clean. The catalog still knows the work; nothing that
                // may air can play it, so it is one track skipped rather than a gap.
                //
                // The two are named separately because they want opposite fixes and are otherwise
                // indistinguishable in a log: one is an upstream that dropped a record, the other
                // is the operator's own policy doing exactly what it was set to do.
                this.logger.warn(
                    demandsClean(policy)
                        ? 'director: no clean copy of a chosen track, and the station is clean-only; skipping it'
                        : 'director: no provider still serves a chosen track; skipping it',
                    { track: `${pick.artist} — ${pick.title}` },
                );
                continue;
            }

            const row = metadata.get(trackId);
            resolved.push({
                artistKey: entry.artistKey,
                songKey: entry.songKey,
                pluginId: binding.pluginId,
                externalId: binding.externalId,
                title: row?.title ?? entry.title,
                // The credit as written on the release when the catalog has it, because that
                // is what a listener sees. It is a DISPLAY string and frequently a whole credit
                // line in one element, which is exactly why identity rides beside it rather than
                // being read back out of `artists[0]`.
                artists: row?.credit ? [row.credit] : [entry.artist],
                artist: entry.artist,
                ...(binding.durationMs === undefined ? {} : { durationMs: binding.durationMs }),
                ...(row?.album == null ? {} : { album: row.album }),
                ...(row?.artworkUrl == null ? {} : { artworkUrl: row.artworkUrl }),
                ...(row?.year == null ? {} : { year: row.year }),
                // The snapshot as it stands NOW. It is retaken by `DirectorService` if the
                // measurement lands after this, which is why the mapping is shared rather than
                // written here: see `track.measurement.ts`.
                ...measurementOf(measured.get(trackId)),
                trackId,
            });
        }

        // Last, and only now that every drop above has happened. Spacing a batch and then
        // removing two of its tracks closes the gap back up and puts one artist back on its
        // own heels, which is the one thing this rule exists to prevent. The seed extends that
        // guarantee across the batch boundary: without it the first placement is compared against
        // nothing, and a refill can open with whoever the tail just closed on.
        return spaceArtists(resolved, seedArtistKey).map(toRundownTrack);
    }

    /**
     * Run a batch already bound for the mount through the one instruction no lineup may switch off,
     * without touching anything else about it.
     *
     * For a playlist put on air rather than a set the station generated. `resolve` cannot serve this
     * caller: it ends by respacing the batch and it overwrites title and artist from the catalog row
     * (`resolve`, above), and a playlist's order is the operator's order and its strings are the
     * provider's — neither of which this may touch. So it reuses the same helpers `resolve` calls at
     * the corresponding step — {@link rejectDisliked} over {@link CandidatesRepository.ratingsFor},
     * {@link withinPeriod} over {@link CandidatesRepository.yearsFor}, {@link CandidatesRepository.bindingsFor}
     * under {@link advisoryPolicy} — rather than a second copy of the rule that could drift from it.
     *
     * No rules argument: a playlist gets `NO_RULES` regardless, so the repeat window, the artist
     * cooldown and the per-artist cap have nothing to apply here.
     *
     * A track with no `trackId` — not yet catalogued — passes through UNLESS the policy
     * `demandsClean`, in which case it drops with everything else the advisory rejects: silence is
     * not consent, and an uncatalogued copy has said nothing about its own advisory. See
     * `advisory.policy.ts:80-88`.
     */
    async vet(tracks: readonly RundownTrack[], options: { era?: EraWindow; preference?: readonly string[] }): Promise<RundownTrack[]> {
        if (tracks.length === 0) return [];

        const { era, preference = [] } = options;
        const policy = advisoryPolicy(this.config);
        const trackIds = tracks.flatMap(track => (track.trackId === undefined ? [] : [track.trackId]));

        const [ratings, years, bindings] = await Promise.all([
            this.candidates.ratingsFor(trackIds),
            bindsAnything(era) ? this.candidates.yearsFor(trackIds) : Promise.resolve(new Map<string, number>()),
            this.candidates.bindingsFor(trackIds, preference, policy),
        ]);

        // Built only so `rejectDisliked` can be reused rather than reimplemented: it reads nothing
        // but `.rating`, so the other two `RotationCandidate` fields are blanks nothing here uses.
        const rated = tracks.map(track => ({
            track,
            songKey: '',
            artistKey: '',
            rating: track.trackId === undefined ? undefined : ratings.get(track.trackId),
        }));
        const notDisliked = new Set(rejectDisliked(rated));

        const vetted: RundownTrack[] = [];
        for (const entry of rated) {
            if (!notDisliked.has(entry)) continue;

            const { track } = entry;
            const year = track.trackId === undefined ? undefined : years.get(track.trackId);
            if (bindsAnything(era) && !withinPeriod(year, era)) continue;

            if (track.trackId === undefined) {
                if (demandsClean(policy)) {
                    this.logger.warn('director: no clean copy of a chosen track, and the station is clean-only; skipping it', {
                        track: `${track.artist} — ${track.title}`,
                    });
                    continue;
                }
                vetted.push(track);
                continue;
            }

            if (!bindings.has(track.trackId)) {
                this.logger.warn(
                    demandsClean(policy)
                        ? 'director: no clean copy of a chosen track, and the station is clean-only; skipping it'
                        : 'director: no provider still serves a chosen track; skipping it',
                    { track: `${track.artist} — ${track.title}` },
                );
                continue;
            }

            vetted.push(track);
        }

        return vetted;
    }

    /**
     * Drop everything the rules say may not air, whatever named it.
     *
     * Two reads, both of which {@link CatalogSetGenerator} also makes and neither of which can be
     * shared with it: a generator that never touched the catalog has produced no ratings, and the
     * windows move — a refill that ran a minute ago has itself changed the answer, which is why they
     * are read at judging time rather than passed in.
     *
     * A pick the catalog has no rating row for is KEPT. `identify` has already established the track
     * exists, so a missing rating is a join that found no album rather than a record nobody has an
     * opinion about, and dropping on it would silently refuse tracks for having no artwork.
     *
     * @param avoidArtistKeys - Unioned into the artist-cooldown set before {@link applyRules} runs,
     *   so an artist the caller has flagged is dropped outright rather than merely capped. The
     *   caller scopes this to a narrow window; `judge` itself has no opinion about how wide it is.
     */
    private async judge(
        identified: readonly Identified[],
        rules: ResolvedRules,
        era?: EraWindow,
        avoidArtistKeys?: ReadonlySet<string>,
    ): Promise<Identified[]> {
        const trackIds = identified.map(entry => entry.trackId);
        const [ratings, songKeys, recentArtistKeys, years] = await Promise.all([
            this.candidates.ratingsFor(trackIds),
            this.history.songKeysSince(rules.repeatWindowDays, this.identity.stationKey),
            this.history.artistKeysSince(rules.artistCooldownMinutes, this.identity.stationKey),
            // Only when there is a period to judge against. An unbriefed broadcast pays no round
            // trip for a question nobody asked, which is the same shape the two window reads above
            // take when their rules are switched off.
            bindsAnything(era) ? this.candidates.yearsFor(trackIds) : Promise.resolve(new Map<string, number>()),
        ]);
        // Unioned rather than queried for: the tail's artists are not aired yet, so no window read
        // above could ever have found them. `Set` rather than array union because `applyRules` calls
        // `.has()` on this per candidate.
        const artistKeys = avoidArtistKeys === undefined ? recentArtistKeys : new Set([...recentArtistKeys, ...avoidArtistKeys]);

        const judged = identified.map(entry => {
            const rating = ratings.get(entry.trackId);
            return rating === undefined ? entry : { ...entry, rating };
        });

        // Beside `rejectDisliked` rather than inside `applyRules`, and for `rotation.advisory`'s
        // reason: `NO_RULES` zeroes that bag, and a SETLIST — whose whole mechanism is starting from
        // the rules off — would silently begin playing any decade. The period is not a rotation rule,
        // it is what the broadcast IS.
        const inPeriod = bindsAnything(era) ? judged.filter(entry => withinPeriod(years.get(entry.trackId), era)) : judged;
        if (inPeriod.length < judged.length) {
            this.logger.debug('director: some chosen tracks fall outside the period this broadcast plays', {
                offered: judged.length,
                kept: inPeriod.length,
                era,
            });
        }

        const eligible = applyRules(inPeriod, rules, { songKeys, artistKeys });
        if (eligible.length < inPeriod.length) {
            this.logger.debug('director: the rotation rules dropped some chosen tracks', {
                offered: inPeriod.length,
                kept: eligible.length,
            });
        }
        return eligible;
    }

    /**
     * Attach a canonical id to every pick that has one, keeping the order.
     *
     * A pick that already carries an id is taken at its word: it came from the
     * catalog a moment ago. Only a named pick costs a lookup, and those are looked
     * up one at a time because there is no batch form of "match this title under
     * this artist" that stays as strict as the single one.
     *
     * A pick the catalog misses falls to {@link discover}, which is where the
     * network is, and which is bounded per call.
     */
    private async identify(picks: readonly TrackPick[]): Promise<Identified[]> {
        const identified: Identified[] = [];
        const mayDiscover = this.mayDiscover();
        const cap = discoveryCap(picks.length);
        let attempted = 0;
        let overCap = 0;

        for (const pick of picks) {
            // A pick that already carries an id was read off a catalog row a moment ago, so its
            // own strings ARE that row's — `TrackPick.artist` is documented as the lead artist
            // and never a credit line, and `CatalogSetGenerator` fills it from
            // `deadair.artists.name`.
            let found = pick.trackId
                ? { trackId: pick.trackId, title: pick.title, artist: pick.artist }
                : await this.candidates.findByName(pick.title, pick.artist);

            if (!found && mayDiscover) {
                if (attempted < cap) {
                    attempted += 1;
                    found = await this.discover(pick);
                } else {
                    overCap += 1;
                }
            }

            if (!found) {
                this.logger.warn('director: a chosen track is not in the catalog; skipping it', {
                    track: `${pick.artist} — ${pick.title}`,
                });
                continue;
            }
            identified.push({
                pick,
                trackId: found.trackId,
                title: found.title,
                artist: found.artist,
                // Off the matched ROW rather than the pick that matched it, which is what makes
                // these keys the same ones `play_history` writes when the track airs. The lead
                // artist is what identity is taken from, never the credit line.
                songKey: songKey(found.title, [found.artist]),
                artistKey: artistKey([found.artist]),
            });
        }

        if (overCap > 0) {
            // Said out loud rather than absorbed. A cap that silently truncates reads exactly like a
            // provider that had nothing, and the two want opposite fixes: raise the bound, or look
            // at why a whole batch is naming records nothing carries.
            this.logger.info('director: stopped looking records up at the per-refill cap', { cap, notLookedUp: overCap });
        }
        return identified;
    }

    /**
     * Whether this refill may look records up at a provider.
     *
     * Two conditions, both cheap, and both read per call rather than held. The setting, so an
     * operator confining the station to what it owns is obeyed on the next refill rather than after
     * a restart; and whether any plugin can be searched at all, so a station with no searchable
     * provider skips the whole path instead of discovering it one pick at a time.
     */
    private mayDiscover(): boolean {
        return settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT) && this.lookup.canLookUp();
    }

    /**
     * Find one named record at a provider and make it part of the catalog.
     *
     * The ingest is the point rather than a side effect: the player fetches every record through
     * `track_sources`, so a copy with no binding has no URL and cannot air. Writing the row also
     * puts the record in front of everything that walks the catalog — measurement, enrichment, art —
     * so it is trimmed and illustrated by the existing passes rather than needing anything here.
     *
     * Never throws. A provider that is down, a record nobody carries and an item with no credited
     * artist are all the same outcome to the caller: one pick dropped from a batch that was
     * oversampled against exactly this.
     *
     * Answers with the PROVIDER's title and lead artist, which are the strings the ingest just
     * wrote to `deadair.tracks` — so a record taken in here is keyed exactly as it will be once
     * the catalog holds it, rather than as the pick that went looking for it.
     */
    private async discover(pick: TrackPick): Promise<{ trackId: string; title: string; artist: string } | undefined> {
        try {
            const found = await this.lookup.find(pick.title, pick.artist);
            if (!found) return undefined;

            // `discovered`, which is what keeps the sync's missing sweep from benching it within the
            // hour: this copy is in no playlist and a walk will never see it. See
            // `markMissingTrackSources`.
            const result = await this.ingest.ingestTrack(found.pluginId, found.track, 'discovered');
            if (result.status === 'skipped') {
                this.logger.info('director: a record found at a provider could not become a catalog row', {
                    track: `${pick.artist} — ${pick.title}`,
                    reason: result.reason,
                });
                return undefined;
            }

            this.logger.info('director: took a chosen record into the catalog from a provider', {
                track: `${pick.artist} — ${pick.title}`,
                plugin: found.pluginId,
                // Whether the station had the WORK already and only lacked this copy, which is a
                // different fact about the library from having never heard of it at all.
                created: result.created,
            });
            // The station changing its own library without having been asked to, which is the one
            // thing here an operator might want to have known about afterwards. The names come from
            // the PICK rather than from the provider's row, because a strict match is what let this
            // through and the words the station chose with are the ones worth reading back.
            void this.activity.record({
                module: 'catalog',
                kind: 'track.discovered',
                detail: `${pick.title} by ${pick.artist} was not in the library, so the station took it in from a provider to play it.`,
                data: { pluginId: found.pluginId, trackId: result.trackId, created: result.created },
            });
            // The lead, which `ProviderTrackLookup` has already matched strictly against the pick
            // and which the ingest wrote to the row. Falling back to the pick's own artist covers
            // a provider that credited nobody; the lookup would have refused it, so this is the
            // unreachable arm rather than a second behaviour.
            return { trackId: result.trackId, title: found.track.title, artist: found.track.artists[0] ?? pick.artist };
        } catch (error) {
            this.logger.warn('director: could not look up a chosen record at a provider', {
                track: `${pick.artist} — ${pick.title}`,
                error: errorText(error),
            });
            return undefined;
        }
    }
}
