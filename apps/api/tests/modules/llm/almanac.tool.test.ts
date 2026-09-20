// The tool is an adapter over `AlmanacService` and nothing else, so what is worth testing is the
// shape of what the model sees: that a station which cannot answer is offered no tool at all, that
// the bare call is the normal one, that the entries arrive as somebody else wrote them, and that a
// day nothing could fetch says so rather than going quiet.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { AlmanacService, StationAlmanac } from '../../../src/modules/almanac/almanac.service.js';
import { AlmanacTool } from '../../../src/modules/llm/almanac.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const ALMANAC: StationAlmanac = {
    day: { month: 9, day: 20, date: '09-20', from: 0, until: 1 },
    entries: [
        { kind: 'birth', year: 1966, text: 'Nuno Bettencourt, Portuguese guitarist', url: 'https://example.test/nuno' },
        { kind: 'event', year: 2011, text: 'Something happened.', notable: true },
    ],
};

interface ServiceOptions {
    hasAlmanac?: boolean;
    almanac?: StationAlmanac | undefined;
}

function build(options: ServiceOptions = {}) {
    const read = vi.fn(async (): Promise<StationAlmanac | undefined> => ('almanac' in options ? options.almanac : ALMANAC));

    const service = { hasAlmanac: () => options.hasAlmanac ?? true, read } as unknown as AlmanacService;

    return { tool: new AlmanacTool(service, logger), read };
}

const only = async (tool: AlmanacTool) => (await tool.tools())[0]!;

describe('what the model is offered', () => {
    it('is nothing at all when no almanac plugin is installed', async () => {
        // A declaration whose every call answers "there is no almanac" spends context teaching the
        // model about a tool that cannot help it.
        const { tool } = build({ hasAlmanac: false });

        expect(await tool.tools()).toEqual([]);
    });

    it('is one tool with no obligatory argument, because the bare call is the normal one', async () => {
        const tool = await only(build().tool);

        expect(tool.declaration.name).toBe('get_this_day');
        expect(tool.declaration.parameters.required).toEqual([]);
    });

    it("offers no date, because which day it is is the station's own question", async () => {
        const tool = await only(build().tool);

        expect(Object.keys(tool.declaration.parameters.properties ?? {})).toEqual(['kinds']);
    });

    it("tells the model the entries are somebody else's words and not to add to them", async () => {
        const tool = await only(build().tool);

        expect(tool.declaration.description).toContain('should not add a fact');
    });

    it('answers the freshness question with the guard that actually runs', async () => {
        // A date does not move; the word "today" in front of it does, and that is claims-time.
        expect((await only(build().tool)).freshness).toBe('claims-time');
    });
});

describe('what comes back', () => {
    it('is the day, said the way a presenter would say it', async () => {
        const answer = (await (await only(build().tool)).run({})) as { date: string; saidAs: string };

        expect(answer.date).toBe('09-20');
        expect(answer.saidAs).toBe('20 September');
    });

    it('is the entries as the source published them, with their years', async () => {
        const answer = (await (await only(build().tool)).run({})) as { entries: { kind: string; year?: number; text: string }[] };

        expect(answer.entries).toEqual([
            { kind: 'birth', year: 1966, text: 'Nuno Bettencourt, Portuguese guitarist' },
            { kind: 'event', year: 2011, text: 'Something happened.' },
        ]);
    });

    it("asks for the kinds the model named, in the station's own vocabulary", async () => {
        const { tool, read } = build();

        await (await only(tool)).run({ kinds: ['births', 'observances'] });

        expect(read).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ kinds: ['birth', 'observance'] }));
    });

    it('ignores a kind it does not know rather than refusing the call', async () => {
        const { tool, read } = build();

        await (await only(tool)).run({ kinds: ['births', 'weather'] });

        expect(read).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ kinds: ['birth'] }));
    });

    it('asks for everything when the model named no kinds', async () => {
        const { tool, read } = build();

        await (await only(tool)).run({});

        expect(read).toHaveBeenCalledWith(expect.any(Number), expect.not.objectContaining({ kinds: expect.anything() }));
    });

    it('says there is nothing rather than going quiet, so the model can move on', async () => {
        const { tool } = build({ almanac: undefined });

        const answer = (await (await only(tool)).run({})) as { note?: string };

        expect(answer.note).toContain('Talk about something else');
    });
});
