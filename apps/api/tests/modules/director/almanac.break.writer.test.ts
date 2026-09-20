// The floor under a break about the date: no network, no model, and no way to fail that costs the
// station a break it could have had.
//
// Three things carry the weight. The DECLINE, because a break that announced a piece of history and
// then gave none is worse than the slot being passed over. What `reportOf` frames and what it leaves
// alone, which is this writer's whole safety property: the sentence after the frame is the source's
// own, word for word. And the day CLAIM, which is the only thing standing between "on this day" and
// a break that airs after midnight.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { AlmanacEntry } from '@deadair/plugin-sdk';

import { AlmanacBreakWriter, ALMANAC_BREAK_KEYS, ALMANAC_TEMPLATES, reportOf, saidAs } from '../../../src/modules/director/almanac.break.writer.js';
import { SaidLog } from '../../../src/modules/director/almanac.source.js';
import { unknownPlaceholders } from '../../../src/modules/director/break.templates.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { StationDay } from '../../../src/modules/almanac/almanac.day.js';
import { ALMANAC_KIND } from '../../../src/modules/almanac/almanac.kind.js';

const DAY: StationDay = {
    month: 9,
    day: 20,
    date: '09-20',
    from: new Date('2026-09-20T00:00:00Z').getTime(),
    until: new Date('2026-09-21T00:00:00Z').getTime(),
};

const entry = (overrides: Partial<AlmanacEntry> = {}): AlmanacEntry => ({
    kind: 'birth',
    year: 1966,
    text: 'Nuno Bettencourt, Portuguese guitarist',
    ...overrides,
});

const build = (settings: Record<string, string> = {}) => {
    const config = { get: (key: string, fallback?: unknown) => settings[key] ?? fallback } as unknown as AppConfig;
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const said = new SaidLog();
    return { writer: new AlmanacBreakWriter(config, said, logger), logger, said };
};

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: ALMANAC_KIND,
    almanac: { day: DAY, entries: [entry()] },
    ...overrides,
});

describe('the shipped phrasings', () => {
    it('name nothing the station cannot fill', () => {
        for (const template of ALMANAC_TEMPLATES) expect(unknownPlaceholders(template)).toEqual([]);
    });

    it('every one carries the entry outside its optional parts', () => {
        // A phrasing that could drop the entry is one that can produce "A bit of history for you.
        // Next up, The Cure."
        for (const template of ALMANAC_TEMPLATES) {
            const required = template.replace(/\[\[[^\]]*\]\]/g, '');
            expect(required).toContain('{{almanac.report}}');
        }
    });

    it('puts the entry after a full stop, because the report is a capitalised sentence', () => {
        for (const template of ALMANAC_TEMPLATES) {
            const at = template.indexOf('{{almanac.report}}');
            if (at === 0) continue;
            expect(template.slice(0, at).trimEnd().endsWith('.')).toBe(true);
        }
    });
});

describe('what the frame is allowed to add', () => {
    it('is the year and the kind, with the entry left exactly as it was published', () => {
        expect(reportOf(entry())).toBe('Born on this day in 1966: Nuno Bettencourt, Portuguese guitarist.');
    });

    it('says a death plainly rather than gently, because a feeling is not checkable', () => {
        expect(reportOf(entry({ kind: 'death', year: 1995, text: 'Mia Martini, Italian singer' }))).toBe(
            'Died on this day in 1995: Mia Martini, Italian singer.',
        );
    });

    it('reads an event as the source wrote it', () => {
        const said = reportOf(entry({ kind: 'event', year: 2011, text: 'The United States military ended its policy.' }));

        expect(said).toBe('On this day in 2011: The United States military ended its policy.');
    });

    it('says an observance is today, because it is about no year at all', () => {
        // The source's own capitalisation stands: most of these open with a proper noun.
        expect(reportOf({ kind: 'observance', text: 'Independence Day in Somewhere' })).toBe('Today is Independence Day in Somewhere.');
    });

    it('falls back to the sentence alone when an entry carries no year', () => {
        expect(reportOf({ kind: 'event', text: 'Something happened.' })).toBe('Something happened.');
    });

    it('reads a year before the common era as one', () => {
        expect(reportOf(entry({ kind: 'event', year: -44, text: 'Something happened in Rome.' }))).toBe(
            'On this day in 44 BC: Something happened in Rome.',
        );
    });

    it('does not double a full stop the source already wrote', () => {
        expect(reportOf(entry({ kind: 'event', year: 1999, text: 'Something happened.' }))).toBe('On this day in 1999: Something happened.');
    });

    it('says the date the way somebody would say it, not the way it is keyed', () => {
        expect(saidAs(DAY)).toBe('20 September');
    });
});

describe('writing one', () => {
    it('reads the first entry, which is the one the station leans toward', async () => {
        const { writer } = build();
        const two = { day: DAY, entries: [entry(), entry({ year: 1927, text: 'John Dankworth, English saxophonist' })] };

        const written = await writer.write(request({ almanac: two }));

        expect(written?.script).toContain('Nuno Bettencourt');
        expect(written?.script).not.toContain('Dankworth');
    });

    it('spends that entry, so the next break today reaches for another', async () => {
        const { writer, said } = build();
        const one = entry();

        await writer.write(request({ almanac: { day: DAY, entries: [one] } }));

        expect(said.has(one)).toBe(true);
    });

    it('spends nothing when it declines, because the entry never reached a script', async () => {
        // An operator whose every phrasing needs the record just finished, which this kind is never
        // given: `usable` drops them all and the writer has nothing to say the entry in.
        const { writer, said } = build({ [ALMANAC_BREAK_KEYS.templates]: 'That was {{previous.title}}. {{almanac.report}}' });
        const one = entry();

        await writer.write(request({ almanac: { day: DAY, entries: [one] } }));

        expect(said.has(one)).toBe(false);
    });

    it('names the day for an operator and the break for a listener', async () => {
        const { writer } = build();

        const written = await writer.write(request());

        expect(written?.label).toBe('This day: 09-20');
        expect(written?.listenerLabel).toBe('This day in history');
    });

    it('claims the station\'s own day, always, because every phrasing says "this day"', async () => {
        const { writer } = build();

        const written = await writer.write(request());

        expect(written?.claimsTime).toEqual({ from: DAY.from, until: DAY.until });
    });

    it('records which phrasing produced the line', async () => {
        const { writer } = build({ [ALMANAC_BREAK_KEYS.templates]: 'Here we go. {{almanac.report}}' });

        await writer.write(request());

        expect(writer.detailOfLastWrite()).toEqual({ source: 'Here we go. {{almanac.report}}' });
    });

    it("uses the operator's phrasings when they wrote any", async () => {
        const { writer } = build({ [ALMANAC_BREAK_KEYS.templates]: 'Dust off the archive. {{almanac.report}}' });

        expect((await writer.write(request()))?.script).toBe(
            'Dust off the archive. Born on this day in 1966: Nuno Bettencourt, Portuguese guitarist.',
        );
    });

    it('can say which date it is about', async () => {
        const { writer } = build({ [ALMANAC_BREAK_KEYS.templates]: "It's {{almanac.date}}. {{almanac.report}}" });

        expect((await writer.write(request()))?.script).toContain("It's 20 September.");
    });

    it('says once that a phrasing names something nothing can fill', async () => {
        const { writer, logger } = build({ [ALMANAC_BREAK_KEYS.templates]: 'The {{almanac.horoscope}} today. {{almanac.report}}' });

        await writer.write(request());
        await writer.write(request());

        expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
    });
});

describe('declining', () => {
    it('declines when there is nothing to read out', async () => {
        const { writer } = build();

        await expect(writer.write(request({ almanac: undefined }))).resolves.toBeUndefined();
    });

    it('declines when the day came back with no entries in it', async () => {
        const { writer } = build();

        await expect(writer.write(request({ almanac: { day: DAY, entries: [] } }))).resolves.toBeUndefined();
    });

    it('declines rather than saying a bare sentence when no phrasing fits', async () => {
        const { writer } = build({ [ALMANAC_BREAK_KEYS.templates]: 'That was {{previous.title}}. {{almanac.report}}' });

        await expect(writer.write(request())).resolves.toBeUndefined();
    });

    it('reports no phrasing for a declined break', async () => {
        const { writer } = build();

        await writer.write(request({ almanac: undefined }));

        expect(writer.detailOfLastWrite()).toBeUndefined();
    });
});
