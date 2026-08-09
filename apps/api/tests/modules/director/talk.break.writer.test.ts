// The floor under the writer seam. These are small decisions that are impossible to hear going
// wrong from inside the app — a station saying the same sentence every fourth record sounds exactly
// like a station with one phrasing — so they are table-tested rather than trusted.

import { describe, expect, it } from 'vitest';

import { spoken, TalkBreakWriter, TALK_BREAK_KIND } from '../../../src/modules/director/talk.break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const writer = new TalkBreakWriter();

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
