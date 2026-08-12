import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TasteRepository, type StationTaste } from '#modules/catalog/taste.repository.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What does the operator actually like?", as something a model can ask.
 *
 * ## Why this exists when the prompt already says it
 *
 * `ModelSetGenerator` puts a short version of these lists straight into its system turn, and that
 * is the half that matters most: it is the only half a model with no tool support, or one having a
 * bad night with them, will ever see. This is the other half, for two things the prompt cannot do.
 *
 * It is not TRUNCATED the way the prompt block is. Fifteen artists per kind is what fits beside the
 * search results without crowding them out, and a station with two hundred rated artists is being
 * shown a fraction of itself. A model that wants the rest can ask.
 *
 * And it is available to every other writer. A DJ introducing a record is in the same position as
 * one choosing it — "the station loves this band" is a true thing to say on air only if it is true —
 * and `ToolRegistry` is one map for every caller, so registering it here gives it to all of them
 * rather than to selection alone.
 *
 * ## It reports, it does not enforce
 *
 * Everything here is what somebody said, never what the station will do about it. A dislike is
 * enforced in `PickResolver` against the ratings as they stand at resolution, whatever this
 * returned and whatever the model did with it. The description says so, because a model that thinks
 * a list is advisory spends picks testing it.
 */

/** How many of each kind come back, whatever was asked for. */
const MAX_RESULTS = 60;

@Injectable()
export class StationTasteTool implements ToolSource {
    constructor(
        private readonly taste: TasteRepository,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        return [
            {
                declaration: {
                    name: 'station_taste',
                    // Written for the model. It says what the answer IS (somebody's opinion) and
                    // what it is not (the filter), because a model that believes this is the
                    // enforcement will treat an empty answer as permission.
                    description:
                        "What the station's operator has said they like and dislike, by artist, record and song. Use it to choose records they will enjoy and to avoid ones they have rejected. The station enforces the dislikes on its own, so anything listed there will be dropped even if you choose it.",
                    parameters: {
                        type: 'object',
                        properties: {
                            limit: { type: 'number', description: `How many of each kind, at most ${MAX_RESULTS}.` },
                        },
                        required: [],
                        additionalProperties: false,
                    },
                },
                run: async args => await this.read(args),
            },
        ];
    }

    /**
     * One read of the operator's taste.
     *
     * The totals ride along beside each list, so a model asking for twenty of two hundred can tell
     * it is looking at a sample. A station that has rated nothing answers with empty lists and
     * zeroes, which is an ordinary state: it means nobody has said anything yet, not that the tool
     * failed.
     */
    private async read(args: Record<string, unknown>): Promise<StationTaste> {
        const taste = await this.taste.taste(clampLimit(args.limit));

        this.logger.debug('llm: read the station taste', {
            liked: taste.likedArtists.total + taste.likedAlbums.total + taste.likedTracks.total,
            disliked: taste.dislikedArtists.total + taste.dislikedAlbums.total + taste.dislikedTracks.total,
        });
        return taste;
    }
}

/**
 * The requested limit, or the ceiling.
 *
 * The same shape `LibrarySearchTool` uses and for the same reason: a model asking for everything is
 * asking for its own context to be filled with a list, so the ceiling is enforced rather than
 * honoured, and a nonsense value falls back to it rather than erroring.
 */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
