// A format clock as a file. What is pinned: nothing about the station it came from travels, an import never
// disturbs the order already here, and a band never arrives without the subject it asked for.

import { describe, expect, it } from 'vitest';

import type { ClockBandRecord } from '../../../src/modules/director/clock.bands.js';
import { CLOCK_PACK_FORMAT, packOfClock, planClockPack } from '../../../src/modules/director/clock.pack.js';
import type { ClockPack } from '../../../src/modules/director/types/clock.types.js';
import type { Topic } from '../../../src/modules/topics/topic.js';

const sport: Topic = { id: 't1', kind: 'news', key: 'sport', label: 'Sport', config: { keywords: 'football' }, position: 2 };
const sportNews: ClockBandRecord = {
    id: 'b1',
    at: 'clock',
    minute: 30,
    kind: 'news',
    topic: { id: 't1', key: 'sport', label: 'Sport' },
    position: 4,
    enabled: true,
};
const ident: ClockBandRecord = { id: 'b2', at: 'interval', everyMs: 1_200_000, kind: 'ident', position: 7, enabled: false };

const fileOf = (bands: ClockPack['bands']): ClockPack => ({ format: 'deadair.clock', version: 1, name: 'A file', bands });

describe('packOfClock', () => {
    it('leaves out the id, the order and the switch, and carries the subject whole', () => {
        expect(packOfClock([sportNews, ident], [sport])).toEqual({
            format: CLOCK_PACK_FORMAT,
            version: 1,
            name: 'Format clock',
            bands: [
                { kind: 'news', at: 'clock', minute: 30, topic: { key: 'sport', label: 'Sport', config: { keywords: 'football' } } },
                { kind: 'ident', at: 'interval', everyMs: 1_200_000 },
            ],
        });
    });
});

describe('a hard marker in a file', () => {
    it('travels hard and arrives hard', () => {
        const hard: ClockBandRecord = { id: 'h', at: 'clock', minute: 0, hard: true, kind: 'news', position: 0, enabled: true };
        const file = packOfClock([hard], []);
        expect(file.bands).toEqual([{ kind: 'news', at: 'clock', minute: 0, hard: true }]);

        const reading = planClockPack(file, [], []);
        expect(reading.adding[0]?.shape).toEqual({ at: 'clock', minute: 0, hard: true, kind: 'news' });
        expect(reading.adding[0]?.words).toBe('news: every hour at :00, on the dot');
    });

    it('is the same rule as a soft one at the same time, so it is not added twice', () => {
        const soft: ClockBandRecord = { id: 's', at: 'clock', minute: 0, kind: 'news', position: 0, enabled: true };
        expect(planClockPack(fileOf([{ kind: 'news', at: 'clock', minute: 0, hard: true }]), [soft], []).skipped).toHaveLength(1);
    });
});

describe('planClockPack', () => {
    it('adds after the last band here, in the order of the file', () => {
        const reading = planClockPack(
            fileOf([
                { kind: 'weather', at: 'clock', minute: 15 },
                { kind: 'ident', at: 'clock', minute: 0 },
            ]),
            [sportNews, ident],
            [sport],
        );
        expect(reading.adding.map(band => [band.shape.kind, band.position])).toEqual([
            ['weather', 8],
            ['ident', 9],
        ]);
    });

    it('starts at zero on an empty clock', () => {
        const reading = planClockPack(fileOf([{ kind: 'news', at: 'clock', minute: 0 }]), [], []);
        expect(reading.adding[0]?.position).toBe(0);
    });

    it('skips a rule it holds, subject included', () => {
        const reading = planClockPack(
            fileOf([{ kind: 'news', at: 'clock', minute: 30, topic: { key: 'sport', label: 'Sport' } }]),
            [sportNews],
            [sport],
        );
        expect(reading.adding).toEqual([]);
        expect(reading.skipped).toEqual(['news, Sport: every hour at :30']);
    });

    it('treats the same time with another subject as another rule', () => {
        const reading = planClockPack(
            fileOf([{ kind: 'news', at: 'clock', minute: 30, topic: { key: 'arts', label: 'Arts' } }]),
            [sportNews],
            [sport],
        );
        expect(reading.adding).toHaveLength(1);
    });

    it('reads weekdays in any order as the same rule', () => {
        const held: ClockBandRecord = { id: 'b', at: 'clock', minute: 0, days: [1, 3], kind: 'news', position: 0, enabled: true };
        const reading = planClockPack(fileOf([{ kind: 'news', at: 'clock', minute: 0, days: [3, 1] }]), [held], []);
        expect(reading.skipped).toHaveLength(1);
    });

    it('creates a subject it needs and this station lacks, from the file', () => {
        const reading = planClockPack(
            fileOf([{ kind: 'news', at: 'clock', minute: 0, topic: { key: 'arts', label: 'Arts', config: { a: 1 } } }]),
            [],
            [sport],
        );
        expect(reading.addingTopics).toEqual([{ kind: 'news', key: 'arts', label: 'Arts', config: { a: 1 }, position: 3 }]);
        expect(reading.adding[0]?.subjectKey).toBe('arts');
    });

    it('uses the subject this station holds, leaving its words alone', () => {
        const reading = planClockPack(
            fileOf([{ kind: 'news', at: 'clock', minute: 0, topic: { key: 'sport', label: 'Their sport', config: { other: true } } }]),
            [],
            [sport],
        );
        expect(reading.addingTopics).toEqual([]);
        expect(reading.adding[0]?.subjectKey).toBe('sport');
    });

    it('creates one subject for two bands that share it', () => {
        const topic = { key: 'arts', label: 'Arts' };
        const reading = planClockPack(
            fileOf([
                { kind: 'news', at: 'clock', minute: 0, topic },
                { kind: 'news', at: 'clock', minute: 30, topic },
            ]),
            [],
            [],
        );
        expect(reading.addingTopics).toHaveLength(1);
        expect(reading.adding).toHaveLength(2);
    });

    it('needs no subject for a band that is skipped', () => {
        const held: ClockBandRecord = { ...sportNews, topic: { id: 'x', key: 'arts', label: 'Arts' } };
        const reading = planClockPack(fileOf([{ kind: 'news', at: 'clock', minute: 30, topic: { key: 'arts', label: 'Arts' } }]), [held], []);
        expect(reading.addingTopics).toEqual([]);
    });

    it('drops a band whose subject is not carried whole, rather than adding it without one', () => {
        const reading = planClockPack(fileOf([{ kind: 'news', at: 'clock', minute: 0, topic: { key: 'sport' } }]), [], [sport]);
        expect(reading.adding).toEqual([]);
        expect(reading.dropped[0]).toMatchObject({ entry: 1, words: 'news' });
    });

    it('drops an interval band that does not say how far apart', () => {
        const reading = planClockPack(fileOf([{ kind: 'ident', at: 'interval' }]), [], []);
        expect(reading.dropped[0]?.reason).toBe('an interval band has to say how far apart');
    });

    it('reports a bad entry and keeps reading', () => {
        const reading = planClockPack(fileOf([{ nonsense: true }, { kind: 'news', at: 'clock', minute: 99 }, { kind: 'news', at: 'clock' }]), [], []);
        expect(reading.dropped.map(dropped => dropped.entry)).toEqual([1, 2]);
        expect(reading.adding).toHaveLength(1);
        expect(reading.adding[0]?.shape).toMatchObject({ minute: 0 });
    });
});
