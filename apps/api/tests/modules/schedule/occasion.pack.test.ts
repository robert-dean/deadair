// A set of occasions as a file. What is pinned: only the header can refuse one, a bad entry costs that
// entry, an import only adds and adds switched off, and a file comes back through itself unchanged.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { OccasionPack } from '../../../src/modules/schedule/types/occasions.types.js';
import { packOfOccasions, planOccasionPack } from '../../../src/modules/schedule/occasion.pack.js';
import type { Occasion, OccasionDraft, OccasionRepository } from '../../../src/modules/schedule/occasion.repository.js';
import { OccasionService } from '../../../src/modules/schedule/occasion.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const halloween: Occasion = { id: 'a', words: 'Halloween', rule: { kind: 'fixed', month: 10, day: 31 }, mood: 'fear', enabled: true, position: 10 };
const easter: Occasion = { id: 'b', words: 'Good Friday', rule: { kind: 'easter', offsetDays: -2 }, enabled: false, position: 20 };

const pack = (occasions: Record<string, unknown>[]) => ({ format: 'deadair.occasions' as const, version: 1, name: 'Canadian holidays', occasions });
const canadaDay = { words: 'Canada Day', ruleKind: 'fixed', month: 7, day: 1 };

describe('packOfOccasions', () => {
    it('carries what a day is, and nothing about the station it came from', () => {
        const file = packOfOccasions([halloween, easter]);

        expect(file).toMatchObject({ format: 'deadair.occasions', version: 1 });
        expect(file.occasions).toEqual([
            { words: 'Halloween', ruleKind: 'fixed', month: 10, day: 31, mood: 'fear' },
            { words: 'Good Friday', ruleKind: 'easter', offsetDays: -2 },
        ]);
    });

    it('is a document its own contract accepts', () => {
        expect(OccasionPack.safeParse(packOfOccasions([halloween, easter])).success).toBe(true);
    });

    it('comes back through itself as nothing new', () => {
        const held = [halloween, easter];
        const reading = planOccasionPack(packOfOccasions(held), held);

        expect(reading.adding).toEqual([]);
        expect(reading.dropped).toEqual([]);
        expect(reading.skipped).toEqual(['Halloween', 'Good Friday']);
    });

    it('lands on another station as the same rules, switched off', () => {
        const reading = planOccasionPack(packOfOccasions([halloween, easter]), []);

        expect(reading.adding).toEqual([
            { words: 'Halloween', rule: { kind: 'fixed', month: 10, day: 31 }, mood: 'fear', enabled: false },
            { words: 'Good Friday', rule: { kind: 'easter', offsetDays: -2 }, enabled: false },
        ]);
    });
});

describe('the header', () => {
    it('refuses a file that says it is something else', () => {
        expect(OccasionPack.safeParse({ ...pack([]), format: 'deadair.persona/2' }).success).toBe(false);
    });

    it('refuses a file with no list', () => {
        expect(OccasionPack.safeParse({ format: 'deadair.occasions', version: 1, name: 'x' }).success).toBe(false);
    });

    it('keeps a bad entry from refusing the file', () => {
        expect(OccasionPack.safeParse(pack([{ words: 'x', ruleKind: 'fixed', month: 13, day: 1 }])).success).toBe(true);
    });
});

describe('planOccasionPack', () => {
    it.each([
        ['a month that does not exist', { words: 'Bad', ruleKind: 'fixed', month: 13, day: 1 }, 'month'],
        ['a date that does not exist', { words: 'Bad', ruleKind: 'fixed', month: 6, day: 31 }, 'June has no day 31'],
        ['a kind nobody knows', { words: 'Bad', ruleKind: 'lunar' }, 'ruleKind'],
        ['a field nobody knows', { words: 'Bad', ruleKind: 'fixed', month: 1, day: 1, enabled: true }, 'enabled'],
        ['a rule missing its fields', { words: 'Bad', ruleKind: 'weekday', month: 11 }, 'weekday of a month needs'],
        [
            'a month that calendar does not have',
            { words: 'Bad', ruleKind: 'calendar', calendar: 'hebrew', calendarMonth: 'Shawwal', day: 1 },
            'no month',
        ],
    ])('reports and drops %s, and keeps the rest', (_name, entry, reason) => {
        const reading = planOccasionPack(pack([canadaDay, entry]), []);

        expect(reading.adding.map(draft => draft.words)).toEqual(['Canada Day']);
        expect(reading.dropped).toEqual([{ entry: 2, words: 'Bad', reason: expect.stringContaining(reason) }]);
    });

    it('drops an entry with nothing to say, or that is not an entry at all', () => {
        const reading = planOccasionPack(
            pack([
                { ruleKind: 'easter', offsetDays: 0 },
                { words: '   ', ruleKind: 'easter', offsetDays: 0 },
            ]),
            [],
        );

        expect(reading.adding).toEqual([]);
        expect(reading.dropped.map(dropped => dropped.entry)).toEqual([1, 2]);
    });

    it('takes the same words on another day as another occasion', () => {
        const reading = planOccasionPack(pack([{ words: 'halloween', ruleKind: 'fixed', month: 10, day: 30 }]), [halloween]);

        expect(reading.adding).toHaveLength(1);
    });

    it('skips the same words and rule whatever their case, and a repeat inside the file', () => {
        const reading = planOccasionPack(pack([{ words: ' HALLOWEEN ', ruleKind: 'fixed', month: 10, day: 31 }, canadaDay, canadaDay]), [halloween]);

        expect(reading.skipped).toEqual(['HALLOWEEN', 'Canada Day']);
        expect(reading.adding.map(draft => draft.words)).toEqual(['Canada Day']);
    });

    it('reads a list of dates the same however it was ordered', () => {
        const held: Occasion = { ...halloween, words: 'Diwali', rule: { kind: 'dates', dates: ['2026-11-08', '2027-10-29'] } };
        const reading = planOccasionPack(pack([{ words: 'Diwali', ruleKind: 'dates', dates: ['2027-10-29', '2026-11-08'] }]), [held]);

        expect(reading.skipped).toEqual(['Diwali']);
    });
});

describe('the routes', () => {
    function build(held: Occasion[] = [halloween]) {
        const repository = {
            list: vi.fn(async () => held),
            add: vi.fn(async (_draft: OccasionDraft) => held[0]),
        };
        return {
            repository,
            service: new OccasionService(repository as unknown as OccasionRepository, settingsConfig().config, {} as unknown as Logger),
        };
    }

    it('writes nothing for a preview', async () => {
        const { repository, service } = build();
        const plan = await service.previewImport(
            pack([canadaDay, { words: 'Bad', ruleKind: 'lunar' }, { words: 'Halloween', ruleKind: 'fixed', month: 10, day: 31 }]),
        );

        expect(plan).toMatchObject({ name: 'Canadian holidays', adding: ['Canada Day'], skipped: ['Halloween'] });
        expect(plan.dropped).toHaveLength(1);
        expect(repository.add).not.toHaveBeenCalled();
    });

    it('adds only what is new, switched off, and answers the list', async () => {
        const { repository, service } = build();
        const result = await service.importPack(pack([canadaDay, { words: 'Halloween', ruleKind: 'fixed', month: 10, day: 31 }]));

        expect(repository.add).toHaveBeenCalledOnce();
        expect(repository.add).toHaveBeenCalledWith({ words: 'Canada Day', rule: { kind: 'fixed', month: 7, day: 1 }, enabled: false });
        expect(result.list.occasions).toHaveLength(1);
    });

    it('refuses a later version of the file, and writes nothing', async () => {
        const { repository, service } = build();

        await expect(service.importPack({ ...pack([canadaDay]), version: 2 })).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.previewImport({ ...pack([canadaDay]), version: 2 })).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.add).not.toHaveBeenCalled();
    });
});
