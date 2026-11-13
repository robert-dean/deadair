// A show's festival, read once per scope for whoever asks, and never a reason for a show to stop.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { FestivalBill } from '../../../src/modules/director/festival.bill.js';
import type { FestivalRepository } from '../../../src/modules/schedule/festival.repository.js';
import type { Festival } from '../../../src/modules/schedule/festival.rules.js';

const festival: Festival = { id: 'f1', name: 'Shaky Knees', startsOn: '2027-05-07', endsOn: '2027-05-09', acts: [] };

function build(find: (id: string) => Promise<Festival | undefined>) {
    const repository = { find: vi.fn(find) };
    const logger = { warn: vi.fn() };
    return { bill: new FestivalBill(repository as unknown as FestivalRepository, logger as unknown as Logger), repository, logger };
}

describe('FestivalBill', () => {
    it('reads a festival once for every ask in its scope', async () => {
        const { bill, repository } = build(async () => festival);

        expect(await bill.of('f1')).toBe(festival);
        expect(await bill.of('f1')).toBe(festival);
        expect(repository.find).toHaveBeenCalledTimes(1);
    });

    it('answers nothing for no festival, and asks nothing', async () => {
        const { bill, repository } = build(async () => festival);

        expect(await bill.of(undefined)).toBeUndefined();
        expect(repository.find).not.toHaveBeenCalled();
    });

    it('answers nothing, and says why, when the festival cannot be read', async () => {
        const { bill, logger } = build(async () => {
            throw new Error('connection refused');
        });

        expect(await bill.of('f1')).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    });
});
