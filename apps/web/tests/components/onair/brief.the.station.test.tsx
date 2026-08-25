// Starting a broadcast by describing it. What is tested here is the newest field and the rule it
// follows: a box nobody ticked must say NOTHING, because absent leaves the station's own setting
// standing and `false` would be this form overruling a station that takes calls every hour.

import { describe, expect, it, vi } from 'vitest';

import { BriefTheStation } from '../../../src/components/onair/brief.the.station';
import { render, screen, setupUser } from '../../utils/render';

const putTheStationOnAir = vi.fn(async () => ({ active: true }));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            putTheStationOnAir: (...args: unknown[]) => putTheStationOnAir(...(args as [])),
            getStationAir: () => Promise.resolve({ active: true }),
            getTheRunningOrder: () => Promise.resolve({ items: [] }),
        },
        personas: { listPersonas: () => Promise.resolve({ personas: [] }) },
    },
}));

const brief = async () => {
    putTheStationOnAir.mockClear();
    render(<BriefTheStation />);
    const user = setupUser();
    await user.type(screen.getByLabelText('What the station should play'), 'heavy metal hits');
    return user;
};

const goOnAir = async (user: ReturnType<typeof setupUser>) => await user.click(screen.getByRole('button', { name: 'Go on air' }));

describe('BriefTheStation', () => {
    it('says nothing about calls when nobody ticked the box', async () => {
        const user = await brief();
        await goOnAir(user);

        expect(putTheStationOnAir).toHaveBeenCalledWith(expect.not.objectContaining({ callins: expect.anything() }));
    });

    it('asks for calls when somebody did', async () => {
        const user = await brief();
        await user.click(screen.getByLabelText('Take calls during this broadcast'));
        await goOnAir(user);

        expect(putTheStationOnAir).toHaveBeenCalledWith(expect.objectContaining({ brief: 'heavy metal hits', callins: true }));
    });
});
