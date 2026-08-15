// The floor under a greeting. The one property worth pinning hardest is what it does NOT say: a
// listener who arrived thirty seconds ago did not hear the last record, so back-announcing it is
// announcing something they missed — and the shared `usable` rule would otherwise insist on it.

import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { settingsConfig } from '../../utils/settings.config.js';
import { TEMPLATE_KEYS } from '../../../src/modules/director/break.templates.js';
import { WELCOME_KEYS, WelcomeWriter } from '../../../src/modules/director/welcome.writer.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { RoughTime } from '../../../src/modules/director/clock.words.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const build = (settings: Record<string, string> = {}) => new WelcomeWriter(settingsConfig(settings).config, logger);

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const morning: RoughTime = { words: 'good morning', validFrom: 1_000, validUntil: 9_000 };

const asking = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: 'welcome',
    station: 'Deadair',
    ...overrides,
});

describe('WelcomeWriter', () => {
    it('greets the listener and names the station', async () => {
        const written = await build().write(asking({ next, greeting: morning }));

        expect(written?.script).toContain('Deadair');
        expect(written?.label).toBe('Welcome');
    });

    it('never back-announces the record the listener missed', async () => {
        // The rule this writer exists for. `usable` refuses a phrasing that ignores the record just
        // played, which is right for a talk break and exactly wrong here.
        for (let attempt = 0; attempt < 20; attempt++) {
            const written = await build().write(asking({ previous, next, greeting: morning }));

            expect(written?.script).not.toContain(previous.title);
            expect(written?.script).not.toContain(previous.artist);
        }
    });

    it('still greets somebody when there is no record coming up', async () => {
        // The tail of a running order. Every phrasing keeps its intro optional for this.
        const written = await build().write(asking({ greeting: morning }));

        expect(written?.script).toContain('Deadair');
        expect(written?.claimsNext).toBeFalsy();
    });

    it('says something in the small hours, when there is no greeting to make', async () => {
        // `dayGreeting` answers with nothing between ten at night and five in the morning, and a
        // welcome that needed one would leave the station silent to whoever tuned in then.
        const written = await build().write(asking({ next }));

        expect(written?.script).toBeTruthy();
        expect(written?.script).not.toMatch(/good (morning|afternoon|evening)/);
    });

    it('claims the greeting window only when the words actually carry it', async () => {
        const greeted = await build().write(asking({ next, greeting: morning }));
        if (greeted?.script.includes('good morning')) {
            expect(greeted.claimsTime).toEqual({ from: morning.validFrom, until: morning.validUntil });
        } else {
            // A phrasing whose greeting chunk was dropped promised nothing about the time of day and
            // must not be thrown away later for a claim it never made.
            expect(greeted?.claimsTime).toBeUndefined();
        }

        const silent = await build().write(asking({ next }));
        expect(silent?.claimsTime).toBeUndefined();
    });

    it("uses the operator's phrasings, and restores its own when the box is cleared", async () => {
        const mine = await build({ [WELCOME_KEYS.templates]: 'Welcome aboard {{station.name}}.' }).write(asking({ next, greeting: morning }));
        expect(mine?.script).toBe('Welcome aboard Deadair.');

        // Blank means the station's OWN greetings rather than its talk-break phrasings, which would
        // have it back-announce a record to somebody who has just arrived.
        const cleared = await build({ [WELCOME_KEYS.templates]: '   ' }).write(asking({ previous, next, greeting: morning }));
        expect(cleared?.script).not.toContain(previous.title);
    });

    it('names the presenter where the station has given itself one', async () => {
        const written = await build({
            [TEMPLATE_KEYS.djName]: 'Casey',
            [WELCOME_KEYS.templates]: 'This is {{dj.name}} on {{station.name}}.',
        }).write(asking({ next }));

        expect(written?.script).toBe('This is Casey on Deadair.');
    });

    it('declines rather than inventing when there is nothing true to say', async () => {
        // No station name, no record coming up, no greeting: a welcome to nowhere.
        const written = await build().write({ kind: 'welcome' });

        expect(written).toBeUndefined();
    });

    it('keeps the phrasing it used, so a set of them can be tuned rather than guessed at', async () => {
        const writer = build();
        await writer.write(asking({ next, greeting: morning }));

        expect(writer.detailOfLastWrite()?.source).toBeTruthy();
    });
});
