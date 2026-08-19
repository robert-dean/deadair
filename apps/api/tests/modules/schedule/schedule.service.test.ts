// `current` is four lines and the whole of it is the distinction between two facts that look like
// one: what the clock says should be on, and what the station is actually airing. They differ for
// exactly as long as an operator's own choice is holding, and a console that collapsed them would be
// confidently wrong for precisely that stretch.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';
import type { ScheduleRepository } from '../../../src/modules/schedule/schedule.repository.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const slot = (id: string, startsAtMinutes: number): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
});

function build(options: { slots?: ScheduleSlot[]; airing?: string } = {}) {
    const slots = { list: vi.fn(async () => options.slots ?? []) } as unknown as ScheduleRepository;
    const director = {
        status: vi.fn(() => ({
            active: true,
            airMode: 'audience' as const,
            remaining: 0,
            ...(options.airing === undefined ? {} : { slotId: options.airing }),
        })),
    } as unknown as DirectorService;

    // A real string, not a boolean: every layer of AppConfig holds strings, and a double that hands
    // back something else proves nothing about what the app will read.
    const config = { get: vi.fn(() => 'Europe/London'), has: vi.fn(() => true) } as unknown as AppConfig;

    return new ScheduleService(slots, director, config, logger);
}

describe('ScheduleService.current', () => {
    it('answers nothing at all for a station with no schedule', async () => {
        expect(await build().current()).toEqual({});
    });

    it('reports the same slot twice when the station is airing what is due', async () => {
        // Midnight and midday both exist, so whichever the clock is in, the station is on it.
        const service = build({ slots: [slot('all-day', 0)], airing: 'all-day' });

        expect(await service.current()).toEqual({ slotId: 'all-day', airingSlotId: 'all-day' });
    });

    it('reports both when an operator has taken the station over', async () => {
        // The state the manual-takeover rule creates: the clock wants one slot and the running order
        // belongs to another, and it stays that way until the next slot BEGINS. Both have to come
        // back or the console cannot draw the difference.
        const service = build({ slots: [slot('daytime', 0)], airing: 'evening' });

        expect(await service.current()).toEqual({ slotId: 'daytime', airingSlotId: 'evening' });
    });

    it('leaves the airing slot out for a station that belongs to no slot', async () => {
        // The commonest form of a takeover, and the one worth pinning: a station put on by hand
        // before there was a schedule at all has no slot on its running order. That is an absent
        // field rather than a match, so the console still knows the two disagree.
        const service = build({ slots: [slot('daytime', 0)] });

        expect(await service.current()).toEqual({ slotId: 'daytime' });
    });
});
