// The station's own charts as the menu sees them: named after the station, read from the edition
// week the repository settles on, and handed back in the plugin SDK's shape so nothing downstream
// can tell them from a plugin's.

import { describe, expect, it, vi } from 'vitest';

import { StationChartSource } from '../../../src/modules/charts/station.chart.source.js';
import type { StationChartRepository } from '../../../src/modules/charts/station.chart.repository.js';
import type { WeekTally } from '../../../src/modules/charts/station.chart.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import { STREAM_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const WEEK = '2026-11-02';

const tally = (songKey: string, plays: number, week = WEEK): WeekTally => ({
    week,
    songKey,
    title: songKey,
    artist: 'Portishead',
    plays,
    requests: 0,
    skips: 0,
});

function build(tallies: WeekTally[], liked: string[] = []) {
    const repository = {
        editionWeek: vi.fn(async () => WEEK),
        history: vi.fn(async () => ({ tallies, standings: new Map(liked.map(key => [key, { liked: true, barred: false }])) })),
    };
    const source = new StationChartSource(
        repository as unknown as StationChartRepository,
        new StationIdentity(),
        settingsConfig({ [STREAM_KEYS.title]: 'Night Owl Radio', 'station.timezone': 'Europe/London' }).config,
    );
    return { source, repository };
}

describe('StationChartSource', () => {
    it('names both charts after the station', () => {
        expect(
            build([])
                .source.charts()
                .map(chart => [chart.id, chart.name]),
        ).toEqual([
            ['station:top-40', 'Night Owl Radio Top 40'],
            ['station:favourites', 'Night Owl Radio Favourites'],
        ]);
    });

    it('reads the weekly chart for the edition the repository settles on, with movement on each entry', async () => {
        const { source, repository } = build([
            tally('Glory Box', 5),
            tally('Roads', 3),
            tally('Glory Box', 2, '2026-10-26'),
            tally('Roads', 4, '2026-10-26'),
        ]);

        const entries = await source.fetch('top-40', 40, '2026-11-04');

        expect(repository.editionWeek).toHaveBeenCalledWith(expect.any(String), '2026-11-04');
        expect(repository.history).toHaveBeenCalledWith('main', expect.any(String), WEEK, 52);
        expect(entries).toEqual([
            { rank: 1, title: 'Glory Box', artist: 'Portishead', peak: 1, weeksOn: 2, lastWeek: 2, station: { plays: 5, requests: 0, liked: false } },
            { rank: 2, title: 'Roads', artist: 'Portishead', peak: 1, weeksOn: 2, lastWeek: 1, station: { plays: 3, requests: 0, liked: false } },
        ]);
    });

    it('caps the weekly chart at forty whatever it is asked for', async () => {
        const many = Array.from({ length: 60 }, (_, index) => tally(`Song ${index}`, 100 - index));

        expect(await build(many).source.fetch('top-40', 100)).toHaveLength(40);
    });

    it('reads the favourites from the liked records only', async () => {
        const entries = await build([tally('Glory Box', 5), tally('Roads', 30)], ['Glory Box']).source.fetch('favourites', 100);

        expect(entries.map(entry => entry.title)).toEqual(['Glory Box']);
    });

    it('answers nothing for a chart it does not offer, and reads nothing', async () => {
        const { source, repository } = build([tally('Glory Box', 5)]);

        expect(await source.fetch('top-100', 40)).toEqual([]);
        expect(repository.history).not.toHaveBeenCalled();
    });
});
