import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import type { FestivalAct } from '#modules/schedule/festival.rules.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { bindsAnything } from './candidates.repository.js';
import type { BriefArtist } from './brief.artists.js';
import { heldByCooldown, readMix } from './brief.artist.set.generator.js';
import { FestivalBill } from './festival.bill.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { SimilarPicker, type NeighbourWalk } from './similar.picker.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { artistKey } from './rotation.keys.js';

/**
 * Records by the acts on a festival's bill, for a show built around one, with no model in the room.
 *
 * ## Why a binding of its own, and why first
 *
 * A festival show is FOR its bill, and the bill is a list somebody typed rather than prose, so nothing
 * has to read it: this takes each act's freshest provider top track, the acts off air longest first,
 * exactly as `BriefArtistSetGenerator` does for a brief's acts and for that binding's reasons. Provider
 * top tracks rather than the library, because a festival's undercard is the part of the bill a library
 * is least likely to hold, and `PickResolver` takes in what the library has never held. Registered at the
 * head of the chain, ahead of the brief's acts and the model, and only for its share
 * ({@link FESTIVAL_KEYS.mix}), so the rest of the hour is still the brief's: "the festival's bill and
 * records like it" is a brief, and the model and the similarity walk fill what this leaves.
 *
 * ## Headliners are not favoured
 *
 * The neglect order already reaches every act on the bill in turn; weighting the top of the poster would
 * make a festival show the same five acts the station plays anyway, which is the rut the brief's binding
 * exists to break. The bill's own order breaks ties, so the operator's order still says something.
 *
 * ## It names records and decides nothing
 *
 * The dislike veto, the repeat window, the cooldown and the caps all still run in `PickResolver`. An act
 * the cooldown holds is skipped here as well, as the brief's binding skips one.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const FESTIVAL_GENERATOR = 'festival';

/** The `deadair.settings` keys this binding reads. */
export const FESTIVAL_KEYS = {
    /** What fraction of a festival show's batch is taken from the acts on its bill. 0 is off. */
    mix: 'rotation.festivalMix',
} as const;

/**
 * Six tenths, on by default. Higher than a brief's share, because a festival show is made of its bill
 * where a brief's acts are a part of what it asks for; low enough that the model and the similarity walk
 * still have the rest of the hour, so a bill of eight acts does not become eight acts on repeat.
 */
export const DEFAULT_FESTIVAL_MIX = 0.6;

@Injectable()
export class FestivalSetGenerator extends SetGenerator {
    readonly name = FESTIVAL_GENERATOR;

    /**
     * Whether the "nothing can name an artist's records" line has been said. Once per instance, and the
     * binding is scoped, so that is once per refill of a festival show rather than once per process.
     */
    private saidItCannotName = false;

    constructor(
        private readonly bill: FestivalBill,
        private readonly similarity: SimilarityService,
        private readonly picker: SimilarPicker,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0 || inputs.festivalId === undefined) return [];

        const mix = readMix(this.config.get(FESTIVAL_KEYS.mix, DEFAULT_FESTIVAL_MIX));
        if (mix === 0) return [];

        const festival = await this.bill.of(inputs.festivalId);
        if (festival === undefined || festival.acts.length === 0) return [];

        if (!this.similarity.canNameTracks()) {
            if (!this.saidItCannotName) {
                this.saidItCannotName = true;
                this.logger.info(
                    `director: a show is built around ${festival.name} but no similarity plugin can name an artist's records, so its bill is left to the model`,
                );
            }
            return [];
        }

        const acts = await this.byNeglect(festival.acts);
        const free = acts.filter(act => !heldByCooldown(act, inputs));
        if (free.length === 0) return [];

        const want = Math.max(1, Math.round(inputs.count * mix));
        const smartShuffle = resolveSmartShuffle(this.config);
        const lastAired = await this.history.lastAiredSince(historyDaysFor(smartShuffle), this.identity.stationKey).catch((error: unknown) => {
            this.logger.debug(`director: the festival's acts give their first track, because the history could not be read (${errorText(error)})`);
            return new Map<string, DateTime>();
        });
        const now = DateTime.utc();
        const era = bindsAnything(inputs.era) ? inputs.era : undefined;
        const walk: NeighbourWalk = {
            takenSongs: new Set(inputs.avoidSongKeys ?? []),
            takenArtists: new Set<string>(),
            ...(era === undefined ? {} : { era }),
            freshness: song => freshnessOf(lastAired.get(song), now, smartShuffle.horizonDays),
        };

        const picks: TrackPick[] = [];
        try {
            await this.picker.pickFromArtists(
                free.map(act => act.name),
                want,
                walk,
                picks,
            );
        } catch (error) {
            // Kept: every record above cost an upstream call, and a partial answer is a good one.
            this.logger.warn(`director: taking records from ${festival.name}'s bill stopped early (${errorText(error)})`);
        }

        this.logger.debug(`director: took records from ${festival.name}'s bill, longest off air first`, {
            onBill: festival.acts.length,
            free: free.length,
            want,
            picked: picks.length,
        });
        return picks;
    }

    /** The bill as acts with when each last aired here, never aired first, ties in the bill's order. A failed read keeps the bill's order. */
    private async byNeglect(bill: readonly FestivalAct[]): Promise<BriefArtist[]> {
        const acts = bill.map(act => ({ name: act.artist, artistKey: artistKey([act.artist]) }));
        const lastAired = await this.history
            .lastAiredByArtist([...new Set(acts.map(act => act.artistKey))], this.identity.stationKey)
            .catch((error: unknown) => {
                this.logger.debug(
                    `director: the festival's bill is taken in its own order, because the history could not be read (${errorText(error)})`,
                );
                return new Map<string, DateTime>();
            });
        return orderBillByNeglect(
            acts.map(act => {
                const at = lastAired.get(act.artistKey);
                return { ...act, ...(at === undefined ? {} : { lastAiredAt: at }) };
            }),
        );
    }
}

/**
 * Never aired first, then oldest airing first, ties in the bill's own order. Stable, so the bill's order
 * is what a tie falls back to. Exported for the tests, since it is the whole of the decision.
 */
export function orderBillByNeglect<T extends BriefArtist>(acts: readonly T[]): T[] {
    const aired = (act: BriefArtist): number => act.lastAiredAt?.toMillis() ?? Number.NEGATIVE_INFINITY;
    return [...acts].sort((left, right) => aired(left) - aired(right));
}
