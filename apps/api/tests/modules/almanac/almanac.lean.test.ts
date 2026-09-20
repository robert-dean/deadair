// What a music station reaches for out of a day of general history. Table-tested, because this is
// the file whose mistakes are invisible: claiming a battle as a music anniversary does not fail
// anything, it makes the station announce one in the voice it uses for birthdays.

import { describe, expect, it } from 'vitest';
import type { AlmanacEntry } from '@deadair/plugin-sdk';

import { isMusical, leaned } from '../../../src/modules/almanac/almanac.lean.js';

const entry = (text: string, description?: string, overrides: Partial<AlmanacEntry> = {}): AlmanacEntry => ({
    kind: 'birth',
    text,
    ...(description === undefined ? {} : { subjects: [{ title: 'Somebody', description }] }),
    ...overrides,
});

describe('what counts as music', () => {
    it.each([
        ['a role in the entry itself', entry('Nuno Bettencourt, Portuguese guitarist')],
        ['a role in the description', entry('Somebody, born', 'American singer-songwriter')],
        ['a bass player, which is two words', entry('Chuck Panozzo, American bass player')],
        ['a band', entry('The band played its first concert.')],
        ['a record', entry('Abbey Road was released.', '1969 Beatles album')],
        ['an orchestra', entry('The orchestra gave its first performance.')],
    ])('is %s', (_case, subject) => {
        expect(isMusical(subject)).toBe(true);
    });

    it.each([
        ['a battle', entry('A treaty was signed, ending the war.')],
        ['a world record, which is not a record', entry('A world record was set in the high jump.')],
        ['a concert of nations', entry('The Concert of Europe met at Aix-la-Chapelle.')],
        ['an abandoned settlement, which contains "band"', entry('The settlement was abandoned.')],
        ['an operation, which contains "opera"', entry('The operation began at dawn.')],
        // Measured on the real feed: this one was claimed as music by an `opera` entry in the list,
        // because Wikipedia describes Xenu's article as a space opera.
        ['a space opera', entry('He announced the story of Xenu in a taped lecture.', 'Scientology space opera figure')],
        ['a soap opera', entry('The soap opera was first broadcast.', 'American soap opera')],
        ['a footballer', entry('Charli Grant, Australian soccer player')],
    ])('is not %s', (_case, subject) => {
        expect(isMusical(subject)).toBe(false);
    });

    it('reads accents and capitals as the same words', () => {
        expect(isMusical(entry('Mia Martini, Italian Singer'))).toBe(true);
        expect(isMusical(entry('Someone, French Chanteur', 'French musicien'))).toBe(false);
    });
});

describe('the order the station reads them in', () => {
    const day: AlmanacEntry[] = [
        entry('A treaty was signed.', undefined, { kind: 'event', year: 1801 }),
        entry('Eric Gale, American guitarist', undefined, { year: 1938 }),
        entry('A bridge opened.', undefined, { kind: 'event', year: 1932 }),
        entry('John Dankworth, English saxophonist', undefined, { year: 1927 }),
    ];

    it('puts the musicians first and keeps the rest behind them', () => {
        // An order rather than a cut: the thin days are the ones this feature exists for, and a
        // filter would make the station silent on exactly those.
        expect(leaned(day, 'music').map(item => item.year)).toEqual([1938, 1927, 1801, 1932]);
    });

    it('keeps the source order inside each half, which is by year', () => {
        expect(
            leaned(day, 'music')
                .slice(0, 2)
                .map(item => item.year),
        ).toEqual([1938, 1927]);
    });

    it('throws the rest away only when the operator asked it to', () => {
        expect(leaned(day, 'musicOnly').map(item => item.year)).toEqual([1938, 1927]);
    });

    it('leaves the day exactly as the source published it when the station leans nowhere', () => {
        expect(leaned(day, 'any')).toEqual(day);
    });

    it('answers with nothing rather than falling back when music only finds none', () => {
        expect(leaned([entry('A treaty was signed.')], 'musicOnly')).toEqual([]);
    });
});
