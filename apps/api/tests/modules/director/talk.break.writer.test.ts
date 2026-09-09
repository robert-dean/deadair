// The floor under the writer seam. These are small decisions that are impossible to hear going
// wrong from inside the app — a station saying the same sentence every fourth record sounds exactly
// like a station with one phrasing — so they are table-tested rather than trusted.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { Persona } from '../../../src/modules/personas/persona.js';
import { spoken, TalkBreakWriter, TALK_BREAK_KIND } from '../../../src/modules/director/talk.break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

/** A writer against whatever the operator has set, or against the station's own phrasings. */
const build = (values: Record<string, string> = {}, log = logger()) =>
    new TalkBreakWriter({ get: (key: string, fallback: string) => values[key] ?? fallback } as unknown as AppConfig, log);

const writer = build();

describe('TalkBreakWriter', () => {
    it('writes the kind it claims', () => {
        expect(writer.kind).toBe(TALK_BREAK_KIND);
    });

    it('names both records when it sits between two', async () => {
        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.script).toContain('Solid Air');
        expect(written?.script).toContain('John Martyn');
        expect(written?.script).toContain('Pink Moon');
        expect(written?.script).toContain('Nick Drake');
    });

    it('back-announces alone at the end of an order', async () => {
        // No `next`, so nothing may be promised. Announcing a record that is not coming is the one
        // mistake a listener can actually catch the station out in.
        const written = await writer.write({ kind: TALK_BREAK_KIND, previous });

        expect(written?.script).toContain('Solid Air');
        expect(written?.script).not.toContain('Pink Moon');
        expect(written?.label).toBe('Back-announce: Solid Air');
    });

    it('introduces alone at the top of an order', async () => {
        const written = await writer.write({ kind: TALK_BREAK_KIND, next });

        expect(written?.script).toContain('Pink Moon');
        expect(written?.script).not.toContain('Solid Air');
        expect(written?.label).toBe('Intro: Pink Moon');
    });

    it('says nothing when it has neither neighbour nor a station name', async () => {
        // An ordinary answer, not a fault: there is no true sentence to be made from nothing.
        await expect(writer.write({ kind: TALK_BREAK_KIND })).resolves.toBeUndefined();
    });

    it('can still identify the station with no records either side', async () => {
        const written = await writer.write({ kind: TALK_BREAK_KIND, station: 'Deadair' });

        expect(written?.script).toContain('Deadair');
    });

    it('never repeats the phrasing it has just used', async () => {
        // Run it enough times that a writer ignoring `recent` would fail this by chance alone.
        for (let attempt = 0; attempt < 50; attempt++) {
            const first = await writer.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair' });
            const second = await writer.write({
                kind: TALK_BREAK_KIND,
                previous,
                next,
                station: 'Deadair',
                recent: [first!.script],
            });

            expect(opening(second!.script)).not.toBe(opening(first!.script));
        }
    });

    it('still says something when every phrasing has been used recently', async () => {
        // The fallback that matters: a window longer than the number of phrasings must not leave the
        // station silent, it must only avoid saying the same thing twice running.
        const everything = ['That was anything', 'You just heard anything', 'This is anything', 'Coming up anything', "Here's anything"];

        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair', recent: everything });

        expect(written?.script.length).toBeGreaterThan(0);
        expect(opening(written!.script)).not.toBe(opening(everything[0]!));
    });

    it('reads the title rather than the catalogue entry', async () => {
        const written = await writer.write({
            kind: TALK_BREAK_KIND,
            previous: { title: 'Solid Air (2005 Remaster)', artist: 'John Martyn' },
        });

        expect(written?.script).toContain('Solid Air');
        expect(written?.script).not.toContain('Remaster');
    });
});

describe("TalkBreakWriter against the operator's own phrasings", () => {
    const KEY = 'rotation.breakTemplates';
    const DJ = 'station.djName';

    it('says what the operator wrote', async () => {
        const own = build({
            [KEY]: "Hi, this is {{dj.name}}. We're getting ready to rock out to {{next.name}} by {{next.artist.name}}!",
            [DJ]: 'Sam',
        });

        const written = await own.write({ kind: TALK_BREAK_KIND, next });

        expect(written?.script).toBe("Hi, this is Sam. We're getting ready to rock out to Pink Moon by Nick Drake!");
    });

    it("falls back to the station's own when the setting is empty", async () => {
        // Clearing the box must not leave a silent DJ. The way to stop the station talking is to
        // turn breaks off, which already means exactly that.
        const own = build({ [KEY]: '   \n\n  ' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.script).toContain('Solid Air');
    });

    it('ignores a commented line', async () => {
        const own = build({ [KEY]: '# That was {{previous.title}}.\nYou just heard {{previous.title}}.' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous });

        expect(written?.script).toBe('You just heard Solid Air.');
    });

    it('refuses a phrasing that would air as its own punctuation', async () => {
        // Every part optional, so dropping them leaves the joinery. Not a hypothetical: it is what a
        // model bracketing everything "to be safe" writes, and an empty-string check one line up does
        // not catch it — "—." is not empty. It renders, it speaks, and it sounds like a fault.
        const own = build({ [KEY]: '[[{{station.name}}]] — [[{{previous.title}}]] & [[{{next.title}}]].' });

        const written = await own.write({ kind: TALK_BREAK_KIND });

        expect(written).toBeUndefined();
    });

    it('still uses an over-bracketed phrasing when its parts can be filled', async () => {
        // The guard is about what a phrasing RENDERS to, never about how it was written, so the same
        // line is fine on a boundary that has the records it names.
        const own = build({ [KEY]: '[[{{previous.title}}]] & [[{{next.title}}]].' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.script).toBe('Solid Air & Pink Moon.');
    });

    it('drops an optional chunk it cannot fill, rather than leaving a hole', async () => {
        const own = build({ [KEY]: 'That was {{previous.title}}.[[ Coming up, {{next.title}}.]]' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous });

        expect(written?.script).toBe('That was Solid Air.');
    });

    it('keeps an optional chunk it can fill', async () => {
        const own = build({ [KEY]: 'That was {{previous.title}}.[[ Coming up, {{next.title}}.]]' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous, next });

        expect(written?.script).toBe('That was Solid Air. Coming up, Pink Moon.');
    });

    it('never repeats a phrasing that opens with a placeholder either', async () => {
        // The audition's own failure. A phrasing with no opening literal used to fall through to
        // being matched WHOLE, against a script naming records that have since moved on — so it was
        // never spent, never dropped out of the pool, and went on being picked while the phrasings
        // around it were correctly excluded as they were used. Six breaks, four of them the same
        // sentence, two of those back to back.
        const own = build({
            [KEY]: [
                '{{previous.artist}} there, with {{previous.title}}. Documented.',
                'That was {{previous.title}}, from {{previous.artist}}.',
                'You are listening to {{station.name}}. {{previous.title}} there.',
            ].join('\n'),
        });

        // What the station said at the LAST break, which named a record it has since moved off. That
        // is the whole difficulty: nothing in the words survives into this break except the phrasing.
        const heard = 'Pantera there, with Domination. Documented.';

        // Enough runs that a writer failing to exclude one of three phrasings fails this on chance.
        for (let attempt = 0; attempt < 50; attempt++) {
            const written = await own.write({ kind: TALK_BREAK_KIND, previous, station: 'Deadair', recent: [heard] });

            expect(written?.script).not.toContain('there, with');
        }
    });

    it('does not use a phrasing whose required placeholder is missing', async () => {
        // Never filled with a blank: "That was , from ." is worse than saying nothing, and saying
        // nothing is a thing the station is built to absorb.
        const own = build({ [KEY]: 'That was {{previous.title}}, from {{previous.artist}}.' });

        await expect(own.write({ kind: TALK_BREAK_KIND, next })).resolves.toBeUndefined();
    });

    it('will not lead into the next record while ignoring the one that just ended', async () => {
        // The rule an operator never has to know about. A break that throws away the back-announce
        // throws away the half a listener was waiting for.
        const own = build({ [KEY]: "Here's {{next.artist}} with {{next.title}}." });

        await expect(own.write({ kind: TALK_BREAK_KIND, previous, next })).resolves.toBeUndefined();
        await expect(own.write({ kind: TALK_BREAK_KIND, next })).resolves.toBeDefined();
    });

    it('counts an optional back-announce as saying something about the last record', async () => {
        const own = build({ [KEY]: 'This is {{station.name}}.[[ {{previous.title}} there.]][[ Coming up, {{next.title}}.]]' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair' });

        expect(written?.script).toBe('This is Deadair. Solid Air there. Coming up, Pink Moon.');
    });

    it("reads a title rather than the catalogue entry, in an operator's phrasing too", async () => {
        const own = build({ [KEY]: 'That was {{previous.title}}.' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous: { title: 'Solid Air (2005 Remaster)', artist: 'John Martyn' } });

        expect(written?.script).toBe('That was Solid Air.');
    });

    it('leaves the station name alone, because an operator meant what they typed', async () => {
        const own = build({ [KEY]: 'This is {{station.name}}.' });

        const written = await own.write({ kind: TALK_BREAK_KIND, station: 'Deadair (Deluxe Edition)' });

        expect(written?.script).toBe('This is Deadair (Deluxe Edition).');
    });

    it('skips a phrasing with a typo in it, and says so once', async () => {
        // A typo silently drops a phrasing out of rotation, which from the console looks exactly
        // like one the station has never happened to pick. The one failure here nobody can see.
        const log = logger();
        const own = build({ [KEY]: 'That was {{previous.titel}}.\nYou just heard {{previous.title}}.' }, log);

        const first = await own.write({ kind: TALK_BREAK_KIND, previous });
        await own.write({ kind: TALK_BREAK_KIND, previous });

        expect(first?.script).toBe('You just heard Solid Air.');
        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(vi.mocked(log.warn).mock.calls[0]?.[0]).toContain('previous.titel');
    });

    it('avoids repeating a phrasing an operator wrote', async () => {
        const own = build({ [KEY]: 'That was {{previous.title}}.\nYou just heard {{previous.title}}.' });

        const first = await own.write({ kind: TALK_BREAK_KIND, previous });
        const second = await own.write({ kind: TALK_BREAK_KIND, previous, recent: [first!.script] });

        expect(second?.script).not.toBe(first?.script);
    });
});

// A break the station clock placed should say what time it is, and must claim exactly as long as
// its wording is good for. Getting the claim wrong in either direction is inaudible from here: too
// wide and the station says "just after nine" at twenty past, too narrow and a perfectly good break
// is dropped for a promise it never made.
describe('TalkBreakWriter against the persona on air', () => {
    const KEY = 'rotation.breakTemplates';
    const DJ = 'station.djName';

    /** Enough of a persona to be one. The writer reads two fields of it and nothing else. */
    const pirate = (over: Partial<Persona> = {}): Persona =>
        ({ id: 'p-1', key: 'pirate', label: 'Pirate captain', style: 'a pirate captain', active: true, ...over }) as Persona;

    it("uses the persona's phrasings ahead of the operator's", async () => {
        // The whole point of this phase: the model declines on most breaks by design, so a character
        // that lives only in the prompt is a character the listener meets occasionally.
        const own = build({ [KEY]: 'That was {{previous.title}}, from {{previous.artist}}.' });

        const written = await own.write({
            kind: TALK_BREAK_KIND,
            previous,
            persona: pirate({ templates: 'That there haul was {{previous.title}}, from {{previous.artist}}.' }),
        });

        expect(written?.script).toBe('That there haul was Solid Air, from John Martyn.');
    });

    it("falls through to the operator's when the persona carries none", async () => {
        const own = build({ [KEY]: 'You just heard {{previous.title}}.' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous, persona: pirate() });

        expect(written?.script).toBe('You just heard Solid Air.');
    });

    it("prefers the persona's on-air name to the station's", async () => {
        // Two writers naming the presenter differently is one station with two presenters, as far
        // as a listener can tell.
        const own = build({ [KEY]: 'This is {{dj.name}}, with {{previous.title}}.', [DJ]: 'Sam' });

        const written = await own.write({ kind: TALK_BREAK_KIND, previous, persona: pirate({ djName: 'Captain Salt' }) });

        expect(written?.script).toBe('This is Captain Salt, with Solid Air.');
    });

    it('never mixes the two pools, because a stray plain line is the failure this closes', async () => {
        const own = build({ [KEY]: 'That was {{previous.title}}.\nYou just heard {{previous.title}}.' });
        const persona = pirate({ templates: 'That there haul was {{previous.title}}.\nYe just heard {{previous.title}}.' });

        for (let attempt = 0; attempt < 20; attempt += 1) {
            const written = await own.write({ kind: TALK_BREAK_KIND, previous, persona });
            expect(written?.script).toMatch(/^(That there haul was|Ye just heard)/);
        }
    });
});

describe('TalkBreakWriter and the time', () => {
    const clock = { words: 'just after nine', validFrom: 1_000, validUntil: 500_000 };

    it('says the time when the clock placed the break, and claims its window', async () => {
        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair', clock });

        expect(written?.script).toContain('just after nine');
        expect(written?.claimsTime).toEqual({ from: 1_000, until: 500_000 });
    });

    it('never says the time for an ordinary break, and claims nothing', async () => {
        // Nothing had to be written to keep the clock phrasing out: `{{clock.rough}}` cannot be
        // filled without a time, so the phrasing simply does not apply.
        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair' });

        expect(written?.script).not.toContain('just after');
        expect(written?.claimsTime).toBeUndefined();
    });

    it('still writes a break when no phrasing mentions the time, and claims nothing', async () => {
        // Preferred, not required. A slot that produced nothing is a slot the station is silent in,
        // which is worse than a break that does not happen to say the hour.
        const timeless = build({ 'rotation.breakTemplates': 'That was {{previous.title}}.' });
        const written = await timeless.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair', clock });

        expect(written?.script).toBe('That was Solid Air.');
        expect(written?.claimsTime).toBeUndefined();
    });

    it('claims nothing when the phrasing it picked left the time out', async () => {
        // Two phrasings fit and only one names the hour. Whichever is chosen, the claim has to
        // describe what was actually said — the same rule `claimsNext` follows.
        const written = await writer.write({ kind: TALK_BREAK_KIND, previous, next, station: 'Deadair', clock });

        expect(written?.script.includes('just after nine')).toBe(written?.claimsTime !== undefined);
    });
});

describe('spoken', () => {
    it.each([
        ['Solid Air (2005 Remaster)', 'Solid Air'],
        ['Solid Air - 2005 Remaster', 'Solid Air'],
        ['Rumours [Deluxe Edition]', 'Rumours'],
        ['Pet Sounds (Mono)', 'Pet Sounds'],
        ['Blue Monday (1988 Mix)', 'Blue Monday'],
        ['Wish You Were Here (Radio Edit)', 'Wish You Were Here'],
    ])('drops catalogue furniture from %s', (filed, read) => {
        expect(spoken(filed)).toBe(read);
    });

    it.each([
        // Part of the song, and a listener would notice it going missing.
        ["(Don't Fear) The Reaper", "(Don't Fear) The Reaper"],
        ['Empire State of Mind (feat. Alicia Keys)', 'Empire State of Mind (feat. Alicia Keys)'],
        ['Sgt. Pepper - Reprise', 'Sgt. Pepper - Reprise'],
        ['Marquee Moon', 'Marquee Moon'],
    ])('leaves %s alone', (filed, read) => {
        expect(spoken(filed)).toBe(read);
    });

    it('keeps the filed name when stripping would leave nothing', () => {
        expect(spoken('(Remastered)')).toBe('(Remastered)');
    });
});

/** The part of a script that identifies its phrasing: everything up to the first space-separated pair. */
const opening = (script: string): string => script.split(' ').slice(0, 2).join(' ').toLowerCase();
