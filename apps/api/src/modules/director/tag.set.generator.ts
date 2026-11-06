import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { SimilarityService, TAGGED_ASK } from '#modules/similarity/similarity.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { BlockRulesRepository } from './block.rules.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from './pick.resolver.js';
import { artistKey, creditKey, isArtistHeld, songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';

/**
 * Records in the steered genres that the library may not hold, named by a source that knows what
 * is TAGGED with them ([#207](https://github.com/robert-dean/deadair/discussions/207)).
 *
 * ## The gap this fills
 *
 * A genre steer (`genre.steer.ts`) leans the catalog draw toward records the station already owns
 * and tells the model to choose mostly from those genres. Without a model, nothing reaches past the
 * library for a genre at all: a provider's search matches titles, so the only path from "synthwave"
 * to synthwave the station does not own was a model naming artists from memory. This is that path
 * with no model, and on a station that runs one it is a cheap share beneath it: two requests to a
 * free service, held for half an hour, where a refill is a conversation with tool steps.
 *
 * ## A lean, never only
 *
 * The steer's own rule, kept: this takes its share of a refill ({@link TAG_GENERATOR_KEYS.mix}) and
 * leaves the rest to the generators below it, as the similarity binding does. Nothing is removed for
 * being outside the steer, so a genre the source knows nothing about costs this share and the floor
 * fills it.
 *
 * ## It names records and decides nothing
 *
 * Picks are names, as a chart's are. `PickResolver` judges every one against the dislikes, the
 * never-play rules, the repeat window, the cooldown and the period, and looks up a record the
 * library has never held. So this inherits every rule by doing nothing.
 *
 * ## Deaf to the brief
 *
 * It reads the steer and never the brief, so it says so (`ignoresBrief`), and under a binding brief
 * (`rotation.briefOnly`) the chain leaves its picks out exactly as it leaves the catalog draw's out.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const TAG_GENERATOR = 'tagged';

/** The `deadair.settings` keys this binding reads. */
export const TAG_GENERATOR_KEYS = {
    /** What fraction of a batch may come from records tagged with a steered genre. 0 is off. */
    mix: 'rotation.tagMix',
} as const;

/**
 * A quarter of a refill, and inert without a steer.
 *
 * On by default because it does nothing until an operator sets a steer, which is already a
 * deliberate instruction to lean toward a genre: an operator who asked for synthwave and got only
 * the synthwave they own was served half of what they asked. A quarter rather than the similarity
 * binding's 0.4, because the source samples a popularity window and a steered hour should still be
 * mostly records somebody chose.
 */
export const DEFAULT_TAG_MIX = 0.25;

@Injectable()
export class TagSetGenerator extends SetGenerator {
    readonly name = TAG_GENERATOR;
    override readonly ignoresBrief = true;

    /** Whether the "discovery is off" line has been said. Once per process, as the similarity binding's. */
    private warnedAboutDiscovery = false;

    constructor(
        private readonly similarity: SimilarityService,
        private readonly rules: BlockRulesRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0) return [];

        const mix = readMix(this.config.get(TAG_GENERATOR_KEYS.mix, DEFAULT_TAG_MIX));
        if (mix === 0 || !this.similarity.canNameTagged()) return [];

        const steer = await this.rules.steer().catch((error: unknown) => {
            this.logger.debug(`director: could not read the genre steer, so nothing is found by tag (${errorText(error)})`);
            return undefined;
        });
        if (steer === undefined || steer.genres.length === 0) return [];

        if (!settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT) && !this.warnedAboutDiscovery) {
            this.warnedAboutDiscovery = true;
            this.logger.warn(
                `director: a genre steer is in force but "${DISCOVER_KEY}" is off, so records in it that the library does not already hold cannot air`,
            );
        }

        const want = Math.max(1, Math.round(inputs.count * mix));
        const named = await this.similarity.tracksForTags(steer.genres, 'any', TAGGED_ASK);
        const picks = choose(named, want, inputs, await this.heldArtists(inputs));

        this.logger.debug('director: took records tagged with the steered genres', {
            genres: steer.genres,
            want,
            offered: named.length,
            named: picks.length,
        });
        return picks;
    }

    /**
     * The artists a pick may not be by: aired inside the cooldown, queued near this batch, or in the
     * lineup's tail. The similarity binding's reason: the resolver would drop them anyway, and a
     * share spent on them is a share handed to the floor without anybody saying why.
     */
    private async heldArtists(inputs: SetInputs): Promise<Set<string>> {
        const aired = await this.history
            .artistKeysSince(inputs.rules.artistCooldownMinutes, this.identity.stationKey)
            .catch((error: unknown): Set<string> => {
                this.logger.debug(`director: the tag binding could not read the cooldown, so it holds only the lineup (${errorText(error)})`);
                return new Set();
            });
        return new Set([...aired, ...(inputs.avoidArtistKeys ?? []), ...(inputs.queuedArtistKeys ?? [])]);
    }
}

/**
 * Up to `want` records, in the source's order, one per artist, none the batch is avoiding and none
 * by an artist being held.
 *
 * One per artist because the answer is held for half an hour and a sample of fifty can lean on a
 * few acts: taking each act once spreads this share, and the cooldown moves the next refill on to
 * the acts this one did not take. A record whose year is known and falls outside the broadcast's
 * period is left out here rather than spending a pick the resolver would drop.
 */
export function choose(
    named: readonly { title: string; artist: string; year?: number }[],
    want: number,
    inputs: SetInputs,
    held: ReadonlySet<string>,
): TrackPick[] {
    const avoided = new Set(inputs.avoidSongKeys ?? []);
    const taken = new Set<string>();
    const picks: TrackPick[] = [];

    for (const track of named) {
        if (picks.length >= want) break;
        const key = artistKey([track.artist]);
        if (key.length === 0 || taken.has(key) || isArtistHeld(held, key, creditKey(track.artist))) continue;
        if (avoided.has(songKey(track.title, [track.artist]))) continue;
        if (track.year !== undefined && !inPeriod(track.year, inputs.era)) continue;

        taken.add(key);
        picks.push({ title: track.title, artist: track.artist });
    }
    return picks;
}

const inPeriod = (year: number, era: SetInputs['era']): boolean =>
    (era?.from === undefined || year >= era.from) && (era?.to === undefined || year <= era.to);

/** The mix as a fraction between 0 and 1, on the similarity binding's rule: anything not a number is 0. */
function readMix(value: unknown): number {
    const mix = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(mix) || mix <= 0) return 0;
    return Math.min(mix, 1);
}
