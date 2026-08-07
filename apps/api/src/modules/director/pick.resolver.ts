import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { CandidatesRepository } from './candidates.repository.js';
import type { TrackPick } from './set.generator.js';

/**
 * Turning a chosen track into something the station can actually air.
 *
 * A pick names a work; a lineup item has to name a COPY, because that is what
 * the player is eventually handed — `pluginId` + `externalId`, which is the key
 * of `deadair.track_sources`. This is the step between, and it is where a pick
 * that nothing can play is dropped rather than becoming a gap on the mount.
 *
 * Two rungs today:
 *
 *   1. The pick carries a canonical id (everything the catalog generator picks),
 *      or its title and artist match a catalog row.
 *   2. Neither: the pick is discarded and logged.
 *
 * A third rung — asking the providers to search for a name the catalog has never
 * seen — is deliberately absent. It only matters once something is naming tracks
 * from outside the library, which is an LLM DJ's problem and not this one's, and
 * a bad match there airs the wrong record rather than failing visibly. The shape
 * here leaves room for it: nothing above this cares how a pick became a copy.
 */
@Injectable()
export class PickResolver {
    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly tracks: TracksRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Resolve a batch of picks, in order, dropping what cannot be played.
     *
     * Batched because the two lookups behind it are: one query for the bindings
     * and one for the display metadata, however many picks there are. A refill of
     * fifteen tracks costs the same as one.
     *
     * @param preference - Plugin ids in the operator's order, for a work several
     *   providers can serve.
     */
    async resolve(picks: readonly TrackPick[], preference: readonly string[] = []): Promise<RundownTrack[]> {
        if (picks.length === 0) return [];

        const identified = await this.identify(picks);
        if (identified.length === 0) return [];

        const trackIds = identified.map(entry => entry.trackId);
        const [bindings, metadata] = await Promise.all([
            this.candidates.bindingsFor(trackIds, preference),
            this.tracks.findByIds(trackIds),
        ]);

        const resolved: RundownTrack[] = [];
        for (const { pick, trackId } of identified) {
            const binding = bindings.get(trackId);
            if (!binding) {
                // Every provider that carried it has stopped. The catalog still knows the
                // work; nothing can play it, so it is one track skipped rather than a gap.
                this.logger.warn('director: no provider still serves a chosen track; skipping it', {
                    track: `${pick.artist} — ${pick.title}`,
                });
                continue;
            }

            const row = metadata.get(trackId);
            resolved.push({
                pluginId: binding.pluginId,
                externalId: binding.externalId,
                title: row?.title ?? pick.title,
                // The credit as written on the release when the catalog has it, because that
                // is what a listener sees; the pick's `artist` is an identity, not a display.
                artists: row?.credit ? [row.credit] : [pick.artist],
                ...(binding.durationMs === undefined ? {} : { durationMs: binding.durationMs }),
                ...(row?.album == null ? {} : { album: row.album }),
                ...(row?.artworkUrl == null ? {} : { artworkUrl: row.artworkUrl }),
                ...(row?.year == null ? {} : { year: row.year }),
                trackId,
            });
        }
        return resolved;
    }

    /**
     * Attach a canonical id to every pick that has one, keeping the order.
     *
     * A pick that already carries an id is taken at its word: it came from the
     * catalog a moment ago. Only a named pick costs a lookup, and those are looked
     * up one at a time because there is no batch form of "match this title under
     * this artist" that stays as strict as the single one.
     */
    private async identify(picks: readonly TrackPick[]): Promise<{ pick: TrackPick; trackId: string }[]> {
        const identified: { pick: TrackPick; trackId: string }[] = [];

        for (const pick of picks) {
            const trackId = pick.trackId ?? (await this.candidates.findByName(pick.title, pick.artist));
            if (!trackId) {
                this.logger.warn('director: a chosen track is not in the catalog; skipping it', {
                    track: `${pick.artist} — ${pick.title}`,
                });
                continue;
            }
            identified.push({ pick, trackId });
        }
        return identified;
    }
}
