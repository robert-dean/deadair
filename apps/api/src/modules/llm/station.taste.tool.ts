import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ListeningProfileService, type ListeningProfile } from '#modules/catalog/listening.profile.service.js';
import { TasteRepository, type StationTaste } from '#modules/catalog/taste.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import type { StationTool, ToolSource } from './llm.tools.js';
import { limitArgument } from '#modules/shared/limit.clamp.js';

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

/** The name this tool is offered under, so a caller narrowing a conversation with `onlyTools` names it from here. */
export const STATION_TASTE_TOOL = 'station_taste';

/** How many of each kind come back, whatever was asked for. */
const MAX_RESULTS = 60;

@Injectable()
export class StationTasteTool implements ToolSource {
    constructor(
        private readonly taste: TasteRepository,
        private readonly listening: ListeningProfileService,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        return [
            {
                // What this station is, out of what it has played. A shape rather than an event,
                // and one more break does not move it.
                freshness: 'timeless',
                declaration: {
                    name: STATION_TASTE_TOOL,
                    // Written for the model. It says what the answer IS (somebody's opinion) and
                    // what it is not (the filter), because a model that believes this is the
                    // enforcement will treat an empty answer as permission.
                    description:
                        "What the station's operator has said they like and dislike, by artist, record and song. Use it to choose records they will enjoy and to avoid ones they have rejected. The station enforces the dislikes on its own, so anything listed there will be dropped even if you choose it. `listening`, when present, is who they play elsewhere, with `recent` naming who they played in the last few days: use it to choose records, weaker than what they said, and never mention it on air, because it is their private listening.",
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
    private async read(args: Record<string, unknown>): Promise<StationTaste & { listening?: ListeningProfile & { recent?: string[] } }> {
        const taste = await this.taste.taste(limitArgument(args.limit, MAX_RESULTS));
        const listening = await this.readListening();

        this.logger.debug('llm: read the station taste', {
            liked: taste.likedArtists.total + taste.likedAlbums.total + taste.likedTracks.total,
            disliked: taste.dislikedArtists.total + taste.dislikedAlbums.total + taste.dislikedTracks.total,
        });
        return listening ? { ...taste, listening } : taste;
    }

    /** What they play elsewhere, less anybody they disliked, or nothing. Never fails the tool: the ratings are the answer. */
    private async readListening(): Promise<(ListeningProfile & { recent?: string[] }) | undefined> {
        try {
            const [profile, recentNames] = await Promise.all([this.listening.read(), this.listening.recent()]);
            const recent = await this.taste.withoutDisliked(recentNames);
            if (!profile && recent.length === 0) return undefined;

            return {
                artists: profile ? await this.taste.withoutDisliked(profile.artists) : [],
                genres: profile?.genres ?? [],
                ...(recent.length === 0 ? {} : { recent }),
            };
        } catch (error) {
            this.logger.warn(`llm: could not read what the operator listens to (${errorText(error)})`);
            return undefined;
        }
    }
}
