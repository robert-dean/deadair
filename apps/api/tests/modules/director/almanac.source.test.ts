// What a break about the date is written from: which day it asks about, the three ways of having
// nothing, and the log that stops two bands reading the same anniversary an hour apart. The log is
// built once per test and the SOURCE is rebuilt around it, because that is the lifetime the
// container actually produces — a scoped source holding a singleton log. See `ReadLog`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { AlmanacEntry } from '@deadair/plugin-sdk';

import type { AlmanacService, StationAlmanac } from '../../../src/modules/almanac/almanac.service.js';
import type { StationDay } from '../../../src/modules/almanac/almanac.day.js';
import { ALMANAC_KIND } from '../../../src/modules/almanac/almanac.kind.js';
import { ALMANAC_SOURCE_KEYS, AlmanacSource, SaidLog } from '../../../src/modules/director/almanac.source.js';

const AFTERNOON = new Date('2026-09-20T14:00:00Z').getTime();

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** A config that answers with STRINGS, which is what every layer of `AppConfig` actually holds. */
const config = (rows: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback?: unknown) => rows[key] ?? fallback }) as unknown as AppConfig;

/** The source as the container builds it: scoped, around a log that is not. */
const source = (almanac: AlmanacService, log: Logger = logger(), rows: Record<string, string> = {}): AlmanacSource =>
    new AlmanacSource(almanac, said, config(rows), log);

const DAY: StationDay = {
    month: 9,
    day: 20,
    date: '09-20',
    from: new Date('2026-09-20T00:00:00Z').getTime(),
    until: new Date('2026-09-21T00:00:00Z').getTime(),
};

const entry = (year: number, text: string): AlmanacEntry => ({ kind: 'birth', year, text });

interface Options {
    hasAlmanac?: boolean;
    entries?: AlmanacEntry[];
    day?: StationDay;
    readThrows?: boolean;
}

function service(options: Options = {}): { almanac: AlmanacService; read: ReturnType<typeof vi.fn> } {
    const read = vi.fn(async (): Promise<StationAlmanac | undefined> => {
        if (options.readThrows) throw new Error('the station has no timezone anybody has heard of');
        const entries = options.entries ?? [entry(1966, 'Nuno Bettencourt, Portuguese guitarist')];
        return entries.length === 0 ? undefined : { day: options.day ?? DAY, entries };
    });

    const almanac = {
        hasAlmanac: () => options.hasAlmanac ?? true,
        dayFor: () => options.day ?? DAY,
        read,
    } as unknown as AlmanacService;

    return { almanac, read };
}

let said: SaidLog;

beforeEach(() => {
    vi.clearAllMocks();
    said = new SaidLog();
});

describe('which breaks it answers for', () => {
    it('answers for the kind that reads the date and no other', async () => {
        const { almanac } = service();
        const asked = source(almanac);

        expect(await asked.entriesFor(ALMANAC_KIND, AFTERNOON)).toBeDefined();
        expect(await asked.entriesFor('talkbreak', AFTERNOON)).toBeUndefined();
        expect(await asked.entriesFor('news', AFTERNOON)).toBeUndefined();
    });

    it('asks nobody when a talk break comes past, because a request costs something', async () => {
        const { almanac, read } = service();

        await source(almanac).entriesFor('talkbreak', AFTERNOON);

        expect(read).not.toHaveBeenCalled();
    });

    it('answers for a talk break once the operator has switched the offer on', async () => {
        const { almanac, read } = service();

        const offered = await source(almanac, logger(), { [ALMANAC_SOURCE_KEYS.inTalk]: 'true' }).entriesFor('talkbreak', AFTERNOON);

        expect(offered?.almanac?.entries).toHaveLength(1);
        expect(read).toHaveBeenCalledWith(AFTERNOON);
    });

    it('reads that switch as the STRING a settings row stores', async () => {
        const { almanac, read } = service();

        await source(almanac, logger(), { [ALMANAC_SOURCE_KEYS.inTalk]: 'false' }).entriesFor('talkbreak', AFTERNOON);

        expect(read).not.toHaveBeenCalled();
    });

    it("says a talk break decline at debug, where a band decline is worth an operator's attention", async () => {
        // Nobody asked for the date on a link and nothing was passed over, and the station makes
        // hundreds of them a day. `WeatherSource.say`'s rule.
        const { almanac } = service({ hasAlmanac: false });
        const log = logger();

        await source(almanac, log, { [ALMANAC_SOURCE_KEYS.inTalk]: 'true' }).entriesFor('talkbreak', AFTERNOON);

        expect(vi.mocked(log.info)).not.toHaveBeenCalled();
        expect(vi.mocked(log.debug)).toHaveBeenCalled();
    });
});

describe('which day it asks about', () => {
    it('is the moment the words will be spoken, not now', async () => {
        const { almanac, read } = service();

        await source(almanac).entriesFor(ALMANAC_KIND, AFTERNOON);

        expect(read).toHaveBeenCalledWith(AFTERNOON);
    });

    it('comes back with the window those words may call today', async () => {
        const { almanac } = service();

        const report = await source(almanac).entriesFor(ALMANAC_KIND, AFTERNOON);

        expect(report?.almanac?.day).toEqual(DAY);
    });
});

describe('the ways of having nothing', () => {
    it('is nothing when no plugin can answer, and the log says which fix', async () => {
        const { almanac, read } = service({ hasAlmanac: false });
        const log = logger();

        expect(await source(almanac, log).entriesFor(ALMANAC_KIND, AFTERNOON)).toEqual({});
        expect(read).not.toHaveBeenCalled();
        expect(vi.mocked(log.info).mock.calls[0]?.[0]).toContain('Enable a plugin');
    });

    it('is nothing when the source answered with nothing, and says so at info', async () => {
        const { almanac } = service({ entries: [] });
        const log = logger();

        expect(await source(almanac, log).entriesFor(ALMANAC_KIND, AFTERNOON)).toEqual({});
        expect(vi.mocked(log.info)).toHaveBeenCalled();
    });

    it('is nothing when everything the day had has already been read out today', async () => {
        const only = entry(1966, 'Nuno Bettencourt, Portuguese guitarist');
        const { almanac } = service({ entries: [only] });
        said.keep(only, DAY.date);
        const log = logger();

        expect(await source(almanac, log).entriesFor(ALMANAC_KIND, AFTERNOON)).toEqual({});
        expect(vi.mocked(log.info).mock.calls[0]?.[0]).toContain('already been read out today');
    });

    it('costs the break rather than the job when something throws', async () => {
        const { almanac } = service({ readThrows: true });
        const log = logger();

        await expect(source(almanac, log).entriesFor(ALMANAC_KIND, AFTERNOON)).resolves.toEqual({});
        expect(vi.mocked(log.warn)).toHaveBeenCalled();
    });
});

describe('what the station has already said', () => {
    const day = [entry(1966, 'Nuno Bettencourt, Portuguese guitarist'), entry(1927, 'John Dankworth, English saxophonist')];

    it('is withheld from the next break, across the scope the source lives in', async () => {
        // The source is scoped and the log is not: a new source per break is the lifetime the
        // container produces, and the whole point of the log is that it survives it.
        const { almanac } = service({ entries: day });

        const first = await source(almanac).entriesFor(ALMANAC_KIND, AFTERNOON);
        said.keep(first!.almanac!.entries[0]!, DAY.date);

        const second = await source(almanac).entriesFor(ALMANAC_KIND, AFTERNOON);

        expect(second?.almanac?.entries.map(item => item.year)).toEqual([1927]);
    });

    it('is spent by the writer rather than by the fetch, so a declined break costs nothing', async () => {
        const { almanac } = service({ entries: day });

        await source(almanac).entriesFor(ALMANAC_KIND, AFTERNOON);
        const again = await source(almanac).entriesFor(ALMANAC_KIND, AFTERNOON);

        expect(again?.almanac?.entries.map(item => item.year)).toEqual([1966, 1927]);
    });

    it('is forgotten when the station reaches a new date', async () => {
        const tomorrow: StationDay = { ...DAY, day: 21, date: '09-21' };
        const { almanac } = service({ entries: day });
        said.keep(day[0]!, DAY.date);

        const next = await source(service({ entries: day, day: tomorrow }).almanac).entriesFor(ALMANAC_KIND, AFTERNOON + 86_400_000);

        expect(next?.almanac?.entries.map(item => item.year)).toEqual([1966, 1927]);
    });
});

describe('the log itself', () => {
    it('tells two entries apart by their year as well as their words', () => {
        const early: AlmanacEntry = { kind: 'event', year: 1969, text: 'The Beatles played their last concert.' };
        const late: AlmanacEntry = { kind: 'event', year: 1979, text: 'The Beatles played their last concert.' };

        said.keep(early, DAY.date);

        expect(said.has(early)).toBe(true);
        expect(said.has(late)).toBe(false);
    });

    it('reads two spellings of one entry as one', () => {
        said.keep({ kind: 'event', year: 1969, text: 'The Beatles played their last concert.' }, DAY.date);

        expect(said.has({ kind: 'event', year: 1969, text: 'the beatles played their last concert' })).toBe(true);
    });

    it('is dropped whole when the date turns over, rather than aged out entry by entry', () => {
        const one = entry(1966, 'Nuno Bettencourt, Portuguese guitarist');
        said.keep(one, '09-20');

        said.forget('09-21');

        expect(said.has(one)).toBe(false);
    });
});
