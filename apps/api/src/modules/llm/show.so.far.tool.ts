import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PlayHistoryRepository } from '#modules/director/play.history.repository.js';
import { ScriptHistoryRepository } from '#modules/render/script.history.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { StationTool, ToolSource } from './llm.tools.js';

/**
 * "What has happened on this show so far?", as something a model can ask.
 *
 * ## Why this exists when the prompt already says some of it
 *
 * The same two-halves arrangement `StationTasteTool` and `set.prompt.ts` already run between them,
 * and for the same reason. `break.prompt.ts` puts a short version of both lists in the system turn,
 * because that is the only half a model with no tool support will ever see. This is the other half,
 * for the two things the prompt cannot do.
 *
 * It is not TRUNCATED to what fits beside everything else. A prompt can afford a handful of records
 * before it stops being a brief and starts being a list — and a list is exactly what a model recites
 * back, which is the failure "make one point" exists to stop. A model that wants more can ask for
 * more, and pays for it out of its own context rather than out of every station's.
 *
 * And it lets a RICHER model get a richer show without changing what a smaller one is handed. That
 * is the whole bet of registering it here: the prompt stays the floor, and capability buys depth.
 *
 * ## Which half a caller leans on is decided by its tier
 *
 * A break writer is `air` and has seconds before it falls through to the deterministic floor, so it
 * leans on the prompt line and treats a tool round trip as a bonus. A production pass is
 * `background` with minutes to spend, so it leans on this and its prompt carries almost nothing.
 * `LlmGate.hold` takes one admission for a whole tool loop, so the round trips cost no extra
 * queueing either way.
 *
 * ## Scoped to the BROADCAST, and empty is an ordinary answer
 *
 * "What have we played tonight" is a question about a programme, not about a time window: a window
 * answers it with the tail of the previous show whenever one has just started. A station that is not
 * airing has no broadcast, and this answers with nothing rather than reaching for whichever one was
 * last on — the same rule `StationIdentity` gives every other writer of a `broadcast_id`.
 *
 * ## It reports what happened, and enforces nothing
 *
 * Nothing here is a rule. A record listed as played is not thereby banned from being mentioned, and
 * a line already said is not thereby forbidden — the repeat rules live where they can be judged
 * against something real. The description says so, because a model that thinks a list is a
 * constraint spends the break working around it.
 */

/** How many of each kind come back, whatever was asked for. */
const MAX_RESULTS = 40;

/** What one call answers with. Both lists newest first. */
export interface ShowSoFar {
    /** Records this broadcast has aired, newest first. Lead artist, never a credit line. */
    played: { title: string; artist: string }[];
    /** The things the station has actually said this broadcast, newest first. */
    said: string[];
    /** Whether the station is airing at all. False means both lists are empty for that reason. */
    onAir: boolean;
}

@Injectable()
export class ShowSoFarTool implements ToolSource {
    constructor(
        private readonly plays: PlayHistoryRepository,
        private readonly scripts: ScriptHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {}

    async tools(): Promise<StationTool[]> {
        return [
            {
                declaration: {
                    name: 'show_so_far',
                    // Written for the model, and it says what the answer is FOR. Without the last
                    // sentence a model reads two lists and treats them as material to get through.
                    description:
                        'What this broadcast has played and what the station has already said during it, newest first. Use it to refer back to something earlier in the show and to avoid repeating a line or a point you have already made. It is a record of what happened, not a list of things to mention.',
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

    /** One look at the show in progress. */
    private async read(args: Record<string, unknown>): Promise<ShowSoFar> {
        const broadcastId = this.identity.current();
        if (broadcastId === undefined) return { played: [], said: [], onAir: false };

        const limit = clampLimit(args.limit);
        const [played, said] = await Promise.all([this.plays.duringBroadcast(broadcastId, limit), this.scripts.spokenDuring(broadcastId, limit)]);

        this.logger.debug('llm: read the show so far', { played: played.length, said: said.length });
        return { played, said, onAir: true };
    }
}

/**
 * The requested limit, or the ceiling.
 *
 * The same shape `StationTasteTool` and `LibrarySearchTool` use, and for the same reason: a model
 * asking for everything is asking for its own context to be filled with a list, so the ceiling is
 * enforced rather than honoured, and a nonsense value falls back to it rather than erroring.
 */
function clampLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return MAX_RESULTS;
    return Math.min(MAX_RESULTS, Math.floor(value));
}
