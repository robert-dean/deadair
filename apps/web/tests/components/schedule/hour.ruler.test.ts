import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { AsRunEntry, ClockBand, PlayoutNowPlaying, StationOrderItem } from '@deadair/sdk';

import { hourRulerOf } from '../../../src/components/schedule/hour.ruler';

// 14:20:00 on the station's clock, which is a Wednesday. The browser's clock reads the same moment
// as some other number entirely: nothing here may assume the two share a zone.
const STATION_NOW = '2026-11-18 14:20:00';
const NOW_MS = Date.UTC(2026, 10, 18, 19, 20, 0);
const minutesAgo = (minutes: number) => DateTime.fromMillis(NOW_MS - minutes * 60_000);

const entry = (kind: AsRunEntry['kind'], title: string, startedAgo: number, endedAgo?: number): AsRunEntry =>
    ({ id: title, kind, title, at: minutesAgo(startedAgo), ...(endedAgo === undefined ? {} : { endedAt: minutesAgo(endedAgo) }) }) as AsRunEntry;

const item = (id: string, kind: StationOrderItem['kind'], state: StationOrderItem['state'], durationMs?: number): StationOrderItem =>
    ({ id, kind, state, title: id, ...(durationMs === undefined ? {} : { durationMs }) }) as StationOrderItem;

const band = (minute: number, extra: Partial<ClockBand> = {}): ClockBand =>
    ({ id: `b${minute}`, kind: 'news', at: 'clock', minute, position: 0, enabled: true, ...extra }) as ClockBand;

describe('hourRulerOf', () => {
    it('draws what went out this hour from the log and what is coming from the running order', () => {
        const nowPlaying = { startedAt: NOW_MS - 5 * 60_000, remainingMs: 2 * 60_000 } as PlayoutNowPlaying;
        const ruler = hourRulerOf({
            stationNow: STATION_NOW,
            nowMs: NOW_MS,
            asRun: [
                // Last hour, so it is left out.
                entry('record', 'Before', 30, 21),
                entry('record', 'Earlier', 15, 5),
                entry('break', 'Ident', 6),
                entry('record', 'On now', 5),
            ],
            items: [
                item('On now', 'track', 'airing', 7 * 60_000),
                item('Talk', 'segment', 'planned', 60_000),
                item('Next', 'track', 'planned', 4 * 60_000),
            ],
            nowPlaying,
            bands: [],
        });

        expect(ruler.hour).toBe(14);
        expect(ruler.now).toBe(20);
        expect(ruler.marks).toEqual([
            { kind: 'record', title: 'Earlier', from: 5, to: 15, past: true },
            { kind: 'break', title: 'Ident', from: 14, past: true },
            { kind: 'record', title: 'On now', from: 15, to: 20, past: true },
            // The record on air has two minutes left, then the break, then the next record.
            { kind: 'break', title: 'Talk', from: 22, past: false },
            { kind: 'record', title: 'Next', from: 23, to: 27, past: false },
        ]);
    });

    it('takes only the bands that want this hour on this weekday', () => {
        const ruler = hourRulerOf({
            stationNow: STATION_NOW,
            nowMs: NOW_MS,
            asRun: [],
            items: [],
            nowPlaying: undefined,
            bands: [
                band(30),
                band(0, { hour: 9 }),
                band(5, { days: [0, 6] }),
                band(45, { enabled: false }),
                band(15, { kind: 'weather', topicLabel: 'Atlanta', hard: true, days: [3] }),
                { ...band(0), at: 'interval', minute: undefined, everyMs: 600_000 } as ClockBand,
            ],
        });

        expect(ruler.bands).toEqual([
            { id: 'b15', minute: 15, label: 'Atlanta', hard: true },
            { id: 'b30', minute: 30, label: 'news', hard: false },
        ]);
    });

    it('projects nothing while nothing is going out', () => {
        const ruler = hourRulerOf({
            stationNow: STATION_NOW,
            nowMs: NOW_MS,
            asRun: [],
            items: [item('Next', 'track', 'planned', 60_000)],
            nowPlaying: undefined,
            bands: [],
        });

        expect(ruler.marks).toEqual([]);
    });
});
