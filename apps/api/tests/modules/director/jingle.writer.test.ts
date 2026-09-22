// The station's own jingle. The properties worth pinning are the ones that make it safe to plant an
// hour ahead with nothing checking it at hand-over: it names no record and no time of day, so it
// makes no claim that could go stale. And that it ends on a sting whenever the presenter has a rack.

import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { settingsConfig } from '../../utils/settings.config.js';
import { TEMPLATE_KEYS } from '../../../src/modules/director/break.templates.js';
import { JINGLE_KEYS, JINGLE_TEMPLATES, JingleWriter } from '../../../src/modules/director/jingle.writer.js';
import { PADS_KEY } from '../../../src/modules/render/pad.settings.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { RoughTime } from '../../../src/modules/director/clock.words.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const build = (settings: Record<string, string> = {}) => new JingleWriter(settingsConfig(settings).config, logger);

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };
const morning: RoughTime = { words: 'good morning', validFrom: 1_000, validUntil: 9_000 };

const asking = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: 'jingle',
    station: 'Deadair',
    ...overrides,
});

describe('JingleWriter', () => {
    it('says the station name, labelled as a jingle', async () => {
        const written = await build().write(asking());

        expect(written?.script).toContain('Deadair');
        expect(written?.label).toBe('Jingle');
    });

    it('never names a record or the time of day, and so claims nothing', async () => {
        // A jingle is planted by a spacing rule an hour ahead and is not re-checked at hand-over,
        // so anything it promised could be false by the time it airs.
        for (let attempt = 0; attempt < 30; attempt++) {
            const written = await build().write(asking({ previous, next, greeting: morning }));

            for (const word of [previous.title, previous.artist, next.title, next.artist, 'good morning']) {
                expect(written?.script).not.toContain(word);
            }
            expect(written?.claimsNext).toBeUndefined();
            expect(written?.claimsPrevious).toBeUndefined();
            expect(written?.claimsTime).toBeUndefined();
        }
    });

    it('works through the whole of its own pool without a station name for the presenter', async () => {
        // Every default phrasing is usable with the station name alone, which is all a fresh install has.
        const said = new Set<string>();
        for (let attempt = 0; attempt < 200; attempt++) said.add((await build().write(asking()))!.script);

        expect(said.size).toBe(JINGLE_TEMPLATES.length);
    });

    it('does not repeat one it has just said', async () => {
        const writer = build();
        const first = await writer.write(asking());

        for (let attempt = 0; attempt < 20; attempt++) {
            const second = await writer.write(asking({ recent: [first!.script] }));
            expect(second?.script).not.toBe(first?.script);
        }
    });

    it('names the presenter where the station has given itself one', async () => {
        const written = await build({
            [TEMPLATE_KEYS.djName]: 'Casey',
            [JINGLE_KEYS.templates]: '{{dj.name}} on {{station.name}}.',
        }).write(asking());

        expect(written?.script).toBe('Casey on Deadair.');
    });

    it("uses the operator's phrasings, and restores its own when the box is cleared", async () => {
        const mine = await build({ [JINGLE_KEYS.templates]: '{{station.name}}, loud and clear.' }).write(asking());
        expect(mine?.script).toBe('Deadair, loud and clear.');

        const cleared = await build({ [JINGLE_KEYS.templates]: '   ' }).write(asking());
        expect(cleared?.script).toContain('Deadair');
    });

    it('skips a phrasing that asks for a record, since it is never handed one', async () => {
        const written = await build({ [JINGLE_KEYS.templates]: 'Up next, {{next.title}}.\nThis is {{station.name}}.' }).write(asking({ next }));

        expect(written?.script).toBe('This is Deadair.');
    });

    it('declines rather than inventing when there is no station name for any phrasing', async () => {
        const written = await build({ [JINGLE_KEYS.templates]: 'This is {{station.name}}.' }).write({ kind: 'jingle' });

        expect(written).toBeUndefined();
    });

    it('ends on the least recently hit pad where the presenter has a rack', async () => {
        const written = await build({ [JINGLE_KEYS.templates]: 'This is {{station.name}}.' }).write(asking({ pads: ['whoosh', 'airhorn'] }));

        expect(written?.script).toBe('This is Deadair. [sfx:whoosh]');
    });

    it('is only words with no rack, or with the soundboard switched off', async () => {
        const bare = await build({ [JINGLE_KEYS.templates]: 'This is {{station.name}}.' }).write(asking());
        expect(bare?.script).toBe('This is Deadair.');

        const off = await build({ [JINGLE_KEYS.templates]: 'This is {{station.name}}.', [PADS_KEY]: 'false' }).write(asking({ pads: ['whoosh'] }));
        expect(off?.script).toBe('This is Deadair.');
    });

    it('keeps the phrasing it used, so a set of them can be tuned rather than guessed at', async () => {
        const writer = build();
        await writer.write(asking());

        expect(writer.detailOfLastWrite()?.source).toBeTruthy();
    });
});
