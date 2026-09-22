// The station's own words for a change of programme. The properties worth pinning are the ones a
// listener would hear go wrong: a host thanking themselves, a sustaining source welcomed as though it
// were a show, and a record named on a piece whose job is the shows. And that one list of phrasings
// covers all three moments by picking the most specific line that can be said.

import { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import { settingsConfig } from '../../utils/settings.config.js';
import { TEMPLATE_KEYS } from '../../../src/modules/director/break.templates.js';
import { CHANGEOVER_KEYS, CHANGEOVER_TEMPLATES, ChangeoverWriter } from '../../../src/modules/director/changeover.writer.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { RoughTime } from '../../../src/modules/director/clock.words.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const build = (settings: Record<string, string> = {}) => new ChangeoverWriter(settingsConfig(settings).config, logger);

const persona = (id: string, djName?: string): Persona =>
    ({ id, key: id, kind: 'host', label: id, style: '', defaultHost: false, ...(djName === undefined ? {} : { djName }) }) as Persona;

const morning: RoughTime = { words: 'good morning', validFrom: 1_000, validUntil: 9_000 };

const asking = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: 'changeover',
    station: 'Deadair',
    persona: persona('p-new', 'Ruth'),
    ...overrides,
});

/** Every script the writer produces for one request, over enough attempts to see the whole pool. */
const everything = async (request: BreakWriteRequest, settings: Record<string, string> = {}): Promise<string[]> => {
    const said = new Set<string>();
    for (let attempt = 0; attempt < 120; attempt++) said.add((await build(settings).write(request))!.script);
    return [...said];
};

describe('ChangeoverWriter', () => {
    it('thanks a different outgoing host by name whenever it can', async () => {
        const said = await everything(
            asking({ changeover: { outgoing: persona('p-old', 'Dave'), outgoingShow: 'Breakfast', incomingShow: 'Afternoons' } }),
        );

        // Every line chosen names the host who has just finished. The more general lines fit too, and
        // are never picked while one that says more is available.
        expect(said.length).toBeGreaterThan(0);
        for (const script of said) expect(script).toContain('Dave');
    });

    it('never thanks anybody when the same host carries on into their next show', async () => {
        // No `outgoing` is how the source says "the same host": a host thanking themselves on air is
        // the mistake the shape rules out, and the writer must not reach for a name it was not given.
        const said = await everything(asking({ changeover: { outgoingShow: 'Breakfast', incomingShow: 'Afternoons' } }));

        for (const script of said) {
            expect(script).not.toMatch(/thanks to|handed over/i);
            expect(script).toContain('Afternoons');
        }
    });

    it('names the show that ended, and no show starting, when the station moves to its sustaining source', async () => {
        const said = await everything(asking({ changeover: { outgoingShow: 'Breakfast' } }));

        for (const script of said) expect(script).toContain('Breakfast');
        expect(said.join(' ')).not.toMatch(/sustaining/i);
    });

    it('still says something true when neither side was a show', async () => {
        // An operator's programme ending into the sustaining source: nothing to name but the station.
        const written = await build().write(asking({ changeover: {} }));

        expect(written?.script).toContain('Deadair');
    });

    it('names no record, before or after, and so promises nothing about one', async () => {
        const previous = { title: 'Solid Air', artist: 'John Martyn' };
        const next = { title: 'Pink Moon', artist: 'Nick Drake' };

        for (const script of await everything(asking({ previous, next, changeover: { incomingShow: 'Afternoons' } }))) {
            for (const word of [previous.title, previous.artist, next.title, next.artist]) expect(script).not.toContain(word);
        }

        const written = await build().write(asking({ previous, next, changeover: { incomingShow: 'Afternoons' } }));
        expect(written?.claimsNext).toBeUndefined();
        expect(written?.claimsPrevious).toBeUndefined();
    });

    it('claims the time of day only when the words it chose actually carry the greeting', async () => {
        for (let attempt = 0; attempt < 60; attempt++) {
            const written = await build().write(asking({ greeting: morning, changeover: { incomingShow: 'Afternoons' } }));

            if (written!.script.includes('good morning')) expect(written?.claimsTime).toEqual({ from: 1_000, until: 9_000 });
            else expect(written?.claimsTime).toBeUndefined();
        }
    });

    it('shows the new show on a player while it airs, or the station when there is no show', async () => {
        expect((await build().write(asking({ changeover: { incomingShow: 'Afternoons' } })))?.listenerLabel).toBe('Afternoons');
        expect((await build().write(asking({ changeover: { outgoingShow: 'Breakfast' } })))?.listenerLabel).toBe('Deadair');
    });

    it('uses the operator’s own phrasings, and restores its own when the box is cleared', async () => {
        const mine = { [CHANGEOVER_KEYS.templates]: 'Over to you, {{dj.name}}.' };
        expect((await build(mine).write(asking({ changeover: {} })))?.script).toBe('Over to you, Ruth.');

        const cleared = await everything(asking({ changeover: { incomingShow: 'Afternoons' } }), { [CHANGEOVER_KEYS.templates]: '' });
        expect(cleared.every(script => script.includes('Afternoons'))).toBe(true);
    });

    it('falls back to the station’s presenter name when the host has none of their own', async () => {
        const mine = { [CHANGEOVER_KEYS.templates]: 'Over to you, {{dj.name}}.', [TEMPLATE_KEYS.djName]: 'The Night Owl' };

        expect((await build(mine).write(asking({ persona: persona('p-new'), changeover: {} })))?.script).toBe('Over to you, The Night Owl.');
    });

    it('does not repeat the line it has just said when another fits', async () => {
        const request = asking({ changeover: { incomingShow: 'Afternoons' } });
        const first = (await build().write(request))!.script;

        for (let attempt = 0; attempt < 30; attempt++) {
            expect((await build().write({ ...request, recent: [first] }))?.script).not.toBe(first);
        }
    });

    it('ships default phrasings the vocabulary can fill', () => {
        // A default naming a placeholder nothing fills would never be picked, silently.
        for (const template of CHANGEOVER_TEMPLATES) expect(template).not.toMatch(/\{\{\s*(previous|next)\./);
    });
});
