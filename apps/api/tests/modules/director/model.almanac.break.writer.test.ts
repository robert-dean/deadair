// The model binding for a break about the date. Everything here is about what it will not do: read
// out history it was not given, ask a model at all when the day came back empty, or air an answer
// naming a year nobody looked up.
//
// That last one is this kind's own check, and it is `inventedFigure`'s argument one number over: a
// historical claim's checkable part IS its year, and a model asked about a record released in 1977
// will say 1976 in a sentence no listener can fault. The shape guards every other writer shares
// would not catch it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { AlmanacEntry, LlmMessage } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { ALMANAC_MAX_WORDS, entriesUsed, ModelAlmanacBreakWriter } from '../../../src/modules/director/model.almanac.break.writer.js';
import { SaidLog } from '../../../src/modules/director/almanac.source.js';
import { MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { ALMANAC_KIND } from '../../../src/modules/almanac/almanac.kind.js';
import type { StationDay } from '../../../src/modules/almanac/almanac.day.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const enabled = { [MODEL_WRITER_KEYS.enabled]: true };

const DAY: StationDay = {
    month: 9,
    day: 20,
    date: '09-20',
    from: new Date('2026-09-20T00:00:00Z').getTime(),
    until: new Date('2026-09-21T00:00:00Z').getTime(),
};

const ENTRIES: AlmanacEntry[] = [
    {
        kind: 'birth',
        year: 1966,
        text: 'Nuno Bettencourt, Portuguese guitarist',
        subjects: [{ title: 'Nuno Bettencourt', description: 'Portuguese guitarist' }],
    },
    { kind: 'event', year: 2011, text: 'Something happened.', notable: true },
];

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: ALMANAC_KIND,
    station: 'Deadair',
    almanac: { day: DAY, entries: ENTRIES },
    ...overrides,
});

function build(answer: string, values: Record<string, unknown> = enabled) {
    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: answer,
        finishReason: 'stop',
        usage: { outputTokens: 20 },
    }));
    const llm = { canGenerate: () => true, explainGenerator: () => 'ready', converse } as unknown as LlmService;
    const said = new SaidLog();

    return { writer: new ModelAlmanacBreakWriter(llm, said, config(values), logger), converse, said };
}

/** The system turn as the model was shown it, which is where the rules live. */
const systemTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'system')?.content ?? '');

/** The user turn, which is where the substrate lives: the day, its entries, the record coming up. */
const userTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'user')?.content ?? '');

beforeEach(() => vi.clearAllMocks());

describe('when it will not even ask', () => {
    it('declines with no entries, rather than having a model invent history', async () => {
        const { writer, converse } = build('On this day in 1966, Nuno Bettencourt was born.');

        expect(await writer.write(request({ almanac: undefined }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the day came back with an empty list', async () => {
        const { writer, converse } = build('On this day in 1966, something happened.');

        expect(await writer.write(request({ almanac: { day: DAY, entries: [] } }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the operator has not turned the model writer on', async () => {
        const { writer, converse } = build('On this day in 1966, something happened.', {});

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the setting holds the STRING a settings row stores', async () => {
        // Every layer of `AppConfig` holds text, so a switch read as a boolean is a switch that can
        // be turned on and never off.
        const { writer, converse } = build('On this day in 1966, something happened.', { [MODEL_WRITER_KEYS.enabled]: 'false' });

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });
});

describe('what the model is shown', () => {
    it('is the entries with their years, and the date they belong to', async () => {
        const { writer, converse } = build('On this day in 1966, Nuno Bettencourt was born.');

        await writer.write(request());

        expect(userTurn(converse)).toContain('1966: Nuno Bettencourt, Portuguese guitarist');
        expect(userTurn(converse)).toContain('09-20');
    });

    it('is told the entries are not its to add to', async () => {
        const { writer, converse } = build('On this day in 1966, Nuno Bettencourt was born.');

        await writer.write(request());

        expect(userTurn(converse)).toContain('not yours to add to');
        expect(userTurn(converse)).toContain('which band they were in');
    });

    it('is told to pick one and hand back, in the shape for this kind', async () => {
        const { writer, converse } = build('On this day in 1966, Nuno Bettencourt was born.');

        await writer.write(request());

        // The opening is the user turn's job and the ceiling is the system turn's, which is how
        // every shape in this file is split.
        expect(userTurn(converse)).toContain('Pick ONE of the entries');
        expect(systemTurn(converse)).toContain(String(ALMANAC_MAX_WORDS));
    });

    it('is asked without tools, so it cannot fetch a day the floor would contradict', async () => {
        const { writer, converse } = build('On this day in 1966, Nuno Bettencourt was born.');

        await writer.write(request());

        expect(converse.mock.calls[0]?.[1]).toMatchObject({ tools: false });
    });
});

describe('a year nobody looked up', () => {
    it('is refused outright, because there is no cut that leaves a break worth airing', async () => {
        const { writer } = build('On this day in 1977, Nuno Bettencourt was born.');

        expect(await writer.write(request())).toBeUndefined();
    });

    it('is refused as invented-year, the fault the guard already counts', async () => {
        // The check is `AnswerGuard.years` rather than anything this writer owns: the entries are in
        // the prompt, `permittedYears` reads every year it was shown, and a bespoke copy beside it
        // would be two answers to one question.
        const { writer } = build('On this day in 1977, Nuno Bettencourt was born.');

        await writer.write(request());

        expect(writer.detailOfLastWrite()?.reason).toContain('stated a year the station never gave it');
    });

    it('permits a year the entry text carries, which the station was also given', async () => {
        const withDeath: AlmanacEntry[] = [{ kind: 'death', year: 2024, text: 'Kathryn Crosby, American actress (born 1933)' }];
        const { writer } = build('Kathryn Crosby died on this day in 2024. She was born in 1933.');

        const written = await writer.write(request({ almanac: { day: DAY, entries: withDeath } }));

        expect(written?.script).toContain('1933');
    });

    it('permits arithmetic on the year, which is the whole reason a model is here', async () => {
        const { writer } = build('Nuno Bettencourt turns 60 today, born on this day in 1966.');

        expect((await writer.write(request()))?.script).toContain('turns 60');
    });

    it('catches a spelled-out year too, which the bespoke check it replaced could not', async () => {
        // `yearsIn` reads "nineteen seventy-seven" as 1977, so the guard refuses what a digits-only
        // test would have aired.
        const { writer } = build('On this day in nineteen seventy-seven, something else happened.');

        expect(await writer.write(request())).toBeUndefined();
    });
});

describe('writing one', () => {
    it('airs an answer whose every year was given', async () => {
        const { writer } = build('Born on this day in 1966, Nuno Bettencourt. Here is the next one.');

        const written = await writer.write(request());

        expect(written?.script).toContain('1966');
        expect(written?.listenerLabel).toBe('This day in history');
        expect(written?.label).toBe('This day: 09-20');
    });

    it("claims the station's own day when the script named no time", async () => {
        const { writer } = build('Born on this day in 1966, Nuno Bettencourt.');

        expect((await writer.write(request()))?.claimsTime).toEqual({ from: DAY.from, until: DAY.until });
    });

    it('claims the clock instead when the script really named the time, which is narrower', async () => {
        const clock = { words: 'just after nine', validFrom: DAY.from + 1_000, validUntil: DAY.from + 600_000 };
        const { writer } = build('It is just after nine. Born on this day in 1966, Nuno Bettencourt.');

        const written = await writer.write(request({ clock }));

        expect(written?.claimsTime).toEqual({ from: clock.validFrom, until: clock.validUntil });
    });

    it('spends the entry it actually used and no other', async () => {
        const { writer, said } = build('Born on this day in 1966, Nuno Bettencourt.');

        await writer.write(request());

        expect(said.has(ENTRIES[0]!)).toBe(true);
        expect(said.has(ENTRIES[1]!)).toBe(false);
    });

    it('spends nothing when the answer is refused', async () => {
        const { writer, said } = build('On this day in 1977, something happened.');

        await writer.write(request());

        expect(said.has(ENTRIES[0]!)).toBe(false);
    });

    it('records the model that wrote it', async () => {
        const { writer } = build('Born on this day in 1966, Nuno Bettencourt.');

        await writer.write(request());

        expect(writer.detailOfLastWrite()).toBeDefined();
    });
});

describe('which entry a script used', () => {
    it('is read back out of the years it named', () => {
        expect(entriesUsed('Born in 1966, and here we are.', ENTRIES)).toEqual([ENTRIES[0]]);
    });

    it('is both when a script named both, which spends both', () => {
        expect(entriesUsed('In 1966 and again in 2011.', ENTRIES)).toHaveLength(2);
    });

    it('is nothing when a script named no year at all, which spends nothing', () => {
        // An observance has no year to name, and a model that mentioned one without saying when has
        // made a choice nothing can recover. The entry comes round again later today.
        expect(entriesUsed('Today is a feast day somewhere.', ENTRIES)).toEqual([]);
    });
});
