// The tool reports what happened on this broadcast and enforces nothing, so what is worth testing is
// the shape of that contract: it must be keyed by the BROADCAST rather than by a window (a window
// answers "what have we played tonight" with the tail of the previous show), a station that is not
// airing has to be an ordinary empty answer rather than a reach for whichever broadcast was last on,
// and the ceiling has to be enforced rather than honoured.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import type { ScriptHistoryRepository } from '../../../src/modules/render/script.history.repository.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import { ShowSoFarTool, type ShowSoFar } from '../../../src/modules/llm/show.so.far.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function build(options: { broadcastId?: string; played?: { title: string; artist: string }[]; said?: string[] } = {}) {
    const duringBroadcast = vi.fn(async (_id: string, _limit: number) => options.played ?? []);
    const spokenDuring = vi.fn(async (_id: string, _limit: number) => options.said ?? []);
    const current = vi.fn(() => ('broadcastId' in options ? options.broadcastId : 'broadcast-1'));

    const tool = new ShowSoFarTool(
        { duringBroadcast } as unknown as PlayHistoryRepository,
        { spokenDuring } as unknown as ScriptHistoryRepository,
        { current } as unknown as StationIdentity,
        logger,
    );

    return { tool, duringBroadcast, spokenDuring };
}

/** Call the one tool this source offers, the way the registry would. */
async function call(tool: ShowSoFarTool, args: Record<string, unknown> = {}): Promise<ShowSoFar> {
    const [only] = await tool.tools();
    return (await only!.run(args)) as ShowSoFar;
}

describe('ShowSoFarTool', () => {
    it('answers with what this broadcast played and said, newest first', async () => {
        const { tool, duringBroadcast, spokenDuring } = build({
            played: [{ title: 'Yeah!', artist: 'USHER' }],
            said: ['that was the one before'],
        });

        const answer = await call(tool);

        expect(answer).toEqual({ played: [{ title: 'Yeah!', artist: 'USHER' }], said: ['that was the one before'], onAir: true });
        expect(duringBroadcast).toHaveBeenCalledWith('broadcast-1', expect.any(Number));
        expect(spokenDuring).toHaveBeenCalledWith('broadcast-1', expect.any(Number));
    });

    // The rule `StationIdentity` gives every other writer of a `broadcast_id`: absent means genuinely
    // no broadcast, and reaching for the last one would file this hour under a programme that ended.
    it('answers with nothing, and says so, when the station is not airing', async () => {
        const { tool, duringBroadcast, spokenDuring } = build({ broadcastId: undefined });

        const answer = await call(tool);

        expect(answer).toEqual({ played: [], said: [], onAir: false });
        // Not merely empty: neither table is read at all, because there is no broadcast to read for.
        expect(duringBroadcast).not.toHaveBeenCalled();
        expect(spokenDuring).not.toHaveBeenCalled();
    });

    it('is an ordinary empty answer for a broadcast that has only just started', async () => {
        const { tool } = build({ played: [], said: [] });

        // `onAir` is what tells the model apart from the case above: nothing has happened YET, which
        // is different from there being no show.
        expect(await call(tool)).toEqual({ played: [], said: [], onAir: true });
    });

    describe('the ceiling', () => {
        it('is enforced rather than honoured, so a model cannot ask for its own context to be filled', async () => {
            const { tool, duringBroadcast, spokenDuring } = build();

            await call(tool, { limit: 5_000 });

            const [, playedLimit] = duringBroadcast.mock.calls[0]!;
            const [, saidLimit] = spokenDuring.mock.calls[0]!;
            expect(playedLimit).toBeLessThanOrEqual(40);
            expect(saidLimit).toBeLessThanOrEqual(40);
        });

        it('honours a smaller limit', async () => {
            const { tool, duringBroadcast } = build();

            await call(tool, { limit: 3 });

            expect(duringBroadcast.mock.calls[0]![1]).toBe(3);
        });

        it('falls back to the ceiling for a nonsense limit rather than erroring', async () => {
            const { tool, duringBroadcast } = build();

            await call(tool, { limit: 'lots' });
            await call(tool, { limit: -4 });

            expect(duringBroadcast.mock.calls[0]![1]).toBe(40);
            expect(duringBroadcast.mock.calls[1]![1]).toBe(40);
        });
    });

    // A model that reads two lists as material will get through them, which is the listing failure
    // the whole break prompt is arranged against. The description is the only place this tool can say
    // otherwise.
    it('describes itself as a record of what happened rather than as things to mention', async () => {
        const { tool } = build();
        const [only] = await tool.tools();

        expect(only!.declaration.name).toBe('show_so_far');
        expect(only!.declaration.description).toMatch(/not a list of things to mention/i);
        expect(only!.declaration.description).toMatch(/refer back/i);
    });
});
