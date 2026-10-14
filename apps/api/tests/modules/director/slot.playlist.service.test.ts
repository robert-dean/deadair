// The schedule page's two questions about a slot that resumes its playlist: where it will pick up, and
// starting it over. Both answer a slot this station does not have with a 404 rather than a 500.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { SlotPlaylistService } from '../../../src/modules/director/slot.playlist.service.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import type { PlaylistPositionRepository } from '../../../src/modules/schedule/playlist.position.repository.js';
import type { ScheduleRepository } from '../../../src/modules/schedule/schedule.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const SLOT = '00000000-0000-4000-8000-0000000000aa';

const slot: ScheduleSlot = {
    id: SLOT,
    label: 'Late night',
    startsAtMinutes: 1320,
    endsAtMinutes: 60,
    days: [],
    source: { pluginId: 'deadair.spotify', playlistId: 'pl_1' },
    resumePlaylist: true,
    mode: 'setlist',
    onEnd: 'extend',
};

function build(next?: { title: string; artist: string }) {
    const slots = { list: vi.fn(async () => [slot]) } as unknown as ScheduleRepository;
    const positions = { clear: vi.fn(async () => undefined) } as unknown as PlaylistPositionRepository;
    const console = { nextOnSlotPlaylist: vi.fn(async () => next) } as unknown as DirectorConsoleService;
    return { service: new SlotPlaylistService(slots, positions, console, logger), positions, console };
}

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> =>
    promise.then(
        () => undefined,
        (error: { statusCode?: number }) => error.statusCode,
    );

describe('SlotPlaylistService.position', () => {
    it("answers the console's next record as a title and an artist", async () => {
        const { service } = build({ title: 'Roads', artist: 'Portishead' });

        expect(await service.position(SLOT)).toEqual({ title: 'Roads', artist: 'Portishead' });
    });

    it('answers empty when the slot would start from the top', async () => {
        expect(await build().service.position(SLOT)).toEqual({});
    });

    it('answers 404 for a slot this station does not have, and for an id that is not one', async () => {
        const { service, console } = build();

        expect(await statusOf(service.position('00000000-0000-4000-8000-0000000000ff'))).toBe(404);
        expect(await statusOf(service.position('late-night'))).toBe(404);
        expect(console.nextOnSlotPlaylist).not.toHaveBeenCalled();
    });
});

describe('SlotPlaylistService.restart', () => {
    it('forgets where the slot got to', async () => {
        const { service, positions } = build();

        await service.restart(SLOT);

        expect(positions.clear).toHaveBeenCalledWith(SLOT);
    });

    it('answers 404 for a slot this station does not have', async () => {
        const { service, positions } = build();

        expect(await statusOf(service.restart('00000000-0000-4000-8000-0000000000ff'))).toBe(404);
        expect(positions.clear).not.toHaveBeenCalled();
    });
});
