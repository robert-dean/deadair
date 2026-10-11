import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { bindsAnything } from './candidates.repository.js';
import { BriefArtists, type BriefArtist } from './brief.artists.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { SimilarPicker, type NeighbourWalk } from './similar.picker.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { creditKey, isArtistHeld } from './rotation.keys.js';

/**
 * Records by the acts a brief names, the ones off air longest first, with no model in the room.
 *
 * ## The failure this exists for
 *
 * A model works down a brief's list from the top, and a slow one runs out of time near it. Measured
 * on the live station, 2026-10-11: The Boneyard's brief names twenty-four acts, all in the library,
 * three refills searched the first five, five and seventeen, and six acts took 39 of the show's 86
 * plays. Telling the model the neglected acts first (`BriefArtists` in the set prompt) helps only a
 * model that finishes. This does not need one: it asks the similarity plugins for each neglected
 * act's top tracks and names the freshest, one per act, so every briefed refill reaches the far end
 * of its brief whatever the model does.
 *
 * ## First in the chain, and only for its share
 *
 * Registered AHEAD of `ModelSetGenerator`, which no other binding is, and the share is what makes
 * that safe: it names at most {@link BRIEF_ARTIST_KEYS.mix} of the batch and leaves the rest to the
 * model, which is then asked for fewer records and is likelier to finish inside its time. Behind the
 * model it would only fill what the model left, and a model that answers in full would starve the
 * neglected acts again.
 *
 * ## Provider top tracks, not the library
 *
 * The neglected acts are the ones the library is thinnest on: on that day Behemoth, Morbid Angel,
 * Mastodon and Queensrÿche held one playable record each, which the repeat window rules out after a
 * single airing. A provider's top tracks are what get past that, and `PickResolver` looks up and takes
 * in anything the library has never held, exactly as it does for the similarity walk.
 *
 * ## It names records and decides nothing
 *
 * `PickResolver` runs the dislike veto, the repeat window, the cooldown and the caps over every pick.
 * An act already held by the cooldown (aired or queued inside it) is skipped HERE as well, because
 * naming one spends a share slot on a record that is certain to be dropped.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const BRIEF_ARTIST_GENERATOR = 'brief-artists';

/** The `deadair.settings` keys this binding reads. */
export const BRIEF_ARTIST_KEYS = {
    /** What fraction of a briefed batch is taken from the acts the brief names. 0 is off. */
    mix: 'rotation.briefArtistMix',
} as const;

/**
 * Four tenths, on by default. A brief that names its acts is an instruction, and this is the binding
 * that reads all of it. High enough that a refill of fifteen reaches six neglected acts; low enough
 * that the model still programmes most of the hour and can follow the parts of a brief that are not
 * names ("no ballads in a row").
 */
export const DEFAULT_BRIEF_ARTIST_MIX = 0.4;

@Injectable()
export class BriefArtistSetGenerator extends SetGenerator {
    readonly name = BRIEF_ARTIST_GENERATOR;

    /** Whether the "nothing can name an artist's records" line has been said. Once per process. */
    private saidItCannotName = false;

    constructor(
        private readonly briefArtists: BriefArtists,
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
        if (inputs.count <= 0) return [];
        if ((inputs.brief ?? '').trim().length === 0) return [];

        const mix = readMix(this.config.get(BRIEF_ARTIST_KEYS.mix, DEFAULT_BRIEF_ARTIST_MIX));
        if (mix === 0) return [];

        if (!this.similarity.canNameTracks()) {
            if (!this.saidItCannotName) {
                this.saidItCannotName = true;
                this.logger.info(
                    `director: "${BRIEF_ARTIST_KEYS.mix}" is set but no similarity plugin can name an artist's records, so the acts a brief names are left to the model`,
                );
            }
            return [];
        }

        const named = await this.briefArtists.named(inputs.brief);
        const free = named.filter(artist => !held(artist, inputs));
        if (free.length === 0) {
            this.logger.debug('director: the brief names no act that is free to air', { named: named.length });
            return [];
        }

        const want = Math.max(1, Math.round(inputs.count * mix));

        // The similarity walk's own smart shuffle: the freshest of each act's top tracks, so the act
        // comes back with a record it has not just played. Read once per refill, and a failed read
        // costs the lean and never the share.
        const smartShuffle = resolveSmartShuffle(this.config);
        const lastAired = await this.history.lastAiredSince(historyDaysFor(smartShuffle), this.identity.stationKey).catch((error: unknown) => {
            this.logger.debug(`director: the brief's acts give their first track, because the history could not be read (${errorText(error)})`);
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
                free.map(artist => artist.name),
                want,
                walk,
                picks,
            );
        } catch (error) {
            // Kept: every record above cost an upstream call, and a partial answer is a good one.
            this.logger.warn(`director: taking records from the brief's acts stopped early (${errorText(error)})`);
        }

        this.logger.debug('director: took records from the acts the brief names, longest off air first', {
            named: named.length,
            free: free.length,
            want,
            picked: picks.length,
        });
        return picks;
    }
}

/**
 * Whether the cooldown holds this act: aired inside it, or queued inside it, or one the caller has
 * already said to avoid. The resolver would drop its record; naming one wastes a slot of the share.
 */
function held(artist: BriefArtist, inputs: SetInputs): boolean {
    const cooldownMinutes = inputs.rules.artistCooldownMinutes;
    if (cooldownMinutes > 0 && artist.lastAiredAt !== undefined && -artist.lastAiredAt.diffNow('minutes').minutes < cooldownMinutes) return true;

    for (const keys of [inputs.queuedArtistKeys, inputs.avoidArtistKeys]) {
        if (keys !== undefined && isArtistHeld(keys, artist.artistKey, creditKey(artist.name))) return true;
    }
    return false;
}

/** The mix as a fraction between 0 and 1. See the chart binding for why a non-number is 0. */
function readMix(value: unknown): number {
    const mix = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(mix) || mix <= 0) return 0;
    return Math.min(mix, 1);
}
