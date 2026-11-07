// The console's door onto the talk direction. What is pinned: the words are stored on one line and
// trimmed, a direction of nothing but whitespace is refused with a sentence rather than reaching the
// table's check as a 500, and every verb answers the reading the console shows.

import { describe, expect, it, vi } from 'vitest';

import { TalkDirectionService } from '../../../src/modules/director/talk.direction.service.js';

function build(current?: { words: string; endsAt: string }) {
    const directions = {
        direction: vi.fn(async () => current),
        setDirection: vi.fn(async (words: string) => ({ words, endsAt: '2026-11-08T02:00:00.000Z' })),
        clearDirection: vi.fn(async () => undefined),
    };
    return { service: new TalkDirectionService(directions as never), directions };
}

const statusOf = async (call: Promise<unknown>): Promise<number | undefined> =>
    call.then(
        () => undefined,
        (error: { statusCode?: number }) => error.statusCode,
    );

describe('TalkDirectionService', () => {
    it('reads nothing when no direction is in force', async () => {
        expect(await build().service.read()).toEqual({});
    });

    it('reads the direction in force with its end as a UTC instant', async () => {
        const reading = await build({ words: 'Snowed in', endsAt: '2026-11-08T02:00:00.000Z' }).service.read();

        expect(reading.direction?.words).toBe('Snowed in');
        expect(reading.direction?.endsAt.toISO()).toBe('2026-11-08T02:00:00.000Z');
    });

    it('stores the words trimmed and on one line, for the hours asked', async () => {
        const { service, directions } = build();

        const reading = await service.direct({ words: "  It's Sam's\nbirthday   tonight ", hours: 3 });

        expect(directions.setDirection).toHaveBeenCalledWith("It's Sam's birthday tonight", 3);
        expect(reading.direction?.words).toBe("It's Sam's birthday tonight");
    });

    it('refuses a direction of nothing but whitespace with a sentence', async () => {
        const { service, directions } = build();

        expect(await statusOf(service.direct({ words: ' \n\t ', hours: 2 }))).toBe(400);
        expect(directions.setDirection).not.toHaveBeenCalled();
    });

    it('clears the direction and answers that none is in force', async () => {
        const { service, directions } = build({ words: 'Snowed in', endsAt: '2026-11-08T02:00:00.000Z' });

        expect(await service.stop()).toEqual({});
        expect(directions.clearDirection).toHaveBeenCalledOnce();
    });
});
