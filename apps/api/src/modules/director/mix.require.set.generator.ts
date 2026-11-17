import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { DateTime } from 'luxon';
import { errorText } from '#modules/shared/error.text.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { CandidatesRepository } from './candidates.repository.js';
import { refinesGenre } from './genre.match.js';
import { dueRequirements, type MixRequirement } from './mix.flow.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { artistKey, creditKey, isArtistHeld, songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';

export const MIX_REQUIRE_GENERATOR = 'mix-require';

/** How far back "freshest" looks when choosing among a require node's listed records. */
const FRESHNESS_DAYS = 120;

/** How many library records a genre requirement draws to choose one from. */
const GENRE_DRAW = 40;

/**
 * The records a show's mix flow REQUIRES, added ahead of everything else in a refill.
 *
 * A prose brief asking for "a rare sinful pop hit" got one pop record in five Sundays; a `require` node
 * is the station saying it will happen. First in the chain because a requirement is not a share of the
 * hour to be filled after the brief's acts and the model: it is a record the show has promised. One pick
 * per requirement that is due (`dueRequirements`): from its listed records, the one aired longest ago,
 * or else a library record whose band's main genre matches.
 *
 * Each pick names the node that asked for it (`TrackPick.mixEntry`), so `PickResolver` walks it from
 * there and the wiring decides what judges it; a Block downstream still holds it. A requirement whose
 * pick did not air is still due at the next refill, because nothing in the show satisfied it.
 */
@Injectable()
export class MixRequireSetGenerator extends SetGenerator {
    readonly name = MIX_REQUIRE_GENERATOR;

    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0 || inputs.mix === undefined) return [];
        const due = dueRequirements(inputs.mix.flow, inputs.mix.ctx);
        if (due.length === 0) return [];

        const picks: TrackPick[] = [];
        for (const requirement of due.slice(0, inputs.count)) {
            try {
                const pick = requirement.songs.length > 0 ? await this.fromSongs(requirement, inputs) : await this.fromGenre(requirement, inputs);
                if (pick === undefined) {
                    this.logger.info("director: a show's mix flow requires a record and none could be chosen this refill", {
                        node: requirement.nodeId,
                        genres: requirement.genres,
                    });
                    continue;
                }
                picks.push({ ...pick, mixEntry: requirement.nodeId });
            } catch (error) {
                // One requirement costs nothing but itself: it is still due next refill.
                this.logger.warn(`director: choosing a record a show's mix flow requires failed (${errorText(error)})`, { node: requirement.nodeId });
            }
        }
        return picks;
    }

    /** Of the listed records, the one aired longest ago, or never: and not one the order already holds. */
    private async fromSongs(requirement: MixRequirement, inputs: SetInputs): Promise<TrackPick | undefined> {
        const named = requirement.songs.flatMap(song =>
            song.artist === undefined || song.artist.trim() === '' ? [] : [{ title: song.title, artist: song.artist }],
        );
        const open = named.filter(song => inputs.avoidSongKeys?.has(songKey(song.title, [song.artist])) !== true && !this.held(song.artist, inputs));
        if (open.length === 0) return undefined;

        const lastAired = await this.history.lastAiredSince(FRESHNESS_DAYS, this.identity.stationKey).catch(() => new Map<string, DateTime>());
        const age = (song: { title: string; artist: string }) =>
            lastAired.get(songKey(song.title, [song.artist]))?.toMillis() ?? Number.NEGATIVE_INFINITY;
        return [...open].sort((left, right) => age(left) - age(right))[0];
    }

    /** A library record whose band's main genre matches one still wanted. */
    private async fromGenre(requirement: MixRequirement, inputs: SetInputs): Promise<TrackPick | undefined> {
        const drawn = await this.candidates.sampleByMainGenre(requirement.genres, GENRE_DRAW);
        const match = drawn.find(
            row =>
                requirement.genres.some(genre => refinesGenre(row.genre, genre)) &&
                inputs.avoidSongKeys?.has(songKey(row.title, [row.artist])) !== true &&
                !this.held(row.artist, inputs),
        );
        return match === undefined ? undefined : { title: match.title, artist: match.artist, trackId: match.trackId };
    }

    /** An artist the queue or the tail is holding, as the brief's acts are held. */
    private held(artist: string, inputs: SetInputs): boolean {
        return [inputs.queuedArtistKeys, inputs.avoidArtistKeys].some(
            keys => keys !== undefined && isArtistHeld(keys, artistKey([artist]), creditKey(artist)),
        );
    }
}
