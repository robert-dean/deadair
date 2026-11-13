// The console's door onto the festivals: every write answers the list, each festival says where it stands
// today, and an edit keeps where an import came from.

import { describe, expect, it } from 'vitest';

import type { FestivalRepository } from '../../../src/modules/schedule/festival.repository.js';
import type { Festival, FestivalDraft } from '../../../src/modules/schedule/festival.rules.js';
import { FestivalService } from '../../../src/modules/schedule/festival.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

/** A repository held in memory, which is the whole of what the service asks of one. */
function memory(initial: Festival[] = []) {
    const rows = new Map(initial.map(festival => [festival.id, festival]));
    let next = 0;
    const repository = {
        list: async () => [...rows.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
        find: async (id: string) => rows.get(id),
        add: async (draft: FestivalDraft) => {
            const id = `f${++next}`;
            rows.set(id, { id, ...draft });
            return id;
        },
        change: async (id: string, draft: FestivalDraft) => {
            if (!rows.has(id)) return false;
            rows.set(id, { id, ...draft });
            return true;
        },
        remove: async (id: string) => rows.delete(id),
    };
    return { repository: repository as unknown as FestivalRepository, rows };
}

const service = (repository: FestivalRepository) =>
    new FestivalService(repository, settingsConfig({ 'station.timezone': 'America/New_York' }).config);

const past: Festival = { id: 'old', name: 'Old Fest', startsOn: '2001-06-01', endsOn: '2001-06-02', acts: [] };

describe('FestivalService', () => {
    it('lists soonest first, each with where it stands today', async () => {
        const { repository } = memory([past]);
        const list = await service(repository).add({
            name: 'Far Fest',
            startsOn: '2999-06-01',
            endsOn: '2999-06-03',
            acts: [{ artist: 'Wet Leg', headliner: true }],
        });

        expect(list.festivals.map(festival => [festival.name, festival.state])).toEqual([
            ['Old Fest', 'over'],
            ['Far Fest', 'upcoming'],
        ]);
        expect(list.festivals[1]!.acts).toEqual([{ artist: 'Wet Leg', headliner: true }]);
    });

    it('answers a festival that is not there with a 404', async () => {
        const { repository } = memory();
        await expect(
            service(repository).change('missing', { name: 'X', startsOn: '2999-01-01', endsOn: '2999-01-01', acts: [] }),
        ).rejects.toMatchObject({
            statusCode: 404,
        });
        await expect(service(repository).remove('missing')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('keeps where an import came from across an edit', async () => {
        const imported: Festival = { ...past, id: 'tm', source: { pluginId: 'ticketmaster', eventId: 'G5v' } };
        const { repository, rows } = memory([imported]);

        const list = await service(repository).change('tm', { name: 'Old Fest, corrected', startsOn: '2001-06-01', endsOn: '2001-06-02', acts: [] });

        expect(rows.get('tm')!.source).toEqual({ pluginId: 'ticketmaster', eventId: 'G5v' });
        expect(list.festivals[0]!.sourcePluginId).toBe('ticketmaster');
    });

    it('removes, and answers what is left', async () => {
        const { repository } = memory([past]);
        expect((await service(repository).remove('old')).festivals).toEqual([]);
    });
});
