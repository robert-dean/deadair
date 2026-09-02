// Changing what the station plays. The whole of what is worth testing here is the SCOPE: one
// control now sends two different commands, and picking the wrong one either cuts a listener off
// who should not have been, or quietly fails to start the show somebody asked for.
//
// The call-ins rule comes with it from the briefing box this replaces: a box nobody ticked must say
// NOTHING, because absent leaves the station's own setting standing and `false` would be this form
// overruling a station that takes calls every hour.

import { describe, expect, it, vi } from 'vitest';
import type { StationOrder } from '@deadair/sdk';

import { PlanTheStation } from '../../../src/components/onair/plan.the.station';
import { render, screen, setupUser } from '../../utils/render';

const putTheStationOnAir = vi.fn(async () => ({ active: true }));
const replanTheRunningOrder = vi.fn(async () => undefined);

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            putTheStationOnAir: (...args: unknown[]) => putTheStationOnAir(...(args as [])),
            replanTheRunningOrder: (...args: unknown[]) => replanTheRunningOrder(...(args as [])),
            getStationAir: () => Promise.resolve({ active: true }),
            getTheRunningOrder: () => Promise.resolve({ items: [] }),
        },
        personas: { listPersonas: () => Promise.resolve({ personas: [] }) },
        playlists: { listImportablePlaylists: () => Promise.resolve({ playlists: [], errors: [] }) },
    },
}));

/** A broadcast that is on, so the scope choice exists and defaults to keeping it. */
const running = (over: Partial<StationOrder> = {}): StationOrder =>
    ({
        name: 'Tonight',
        brief: 'heavy metal hits',
        mode: 'rotation',
        onEnd: 'extend',
        source: 'director',
        items: [{ id: 'i1', kind: 'track', state: 'airing', title: 'A Track', artists: ['An Artist'] }],
        ...over,
    }) as StationOrder;

const open = async (order?: StationOrder) => {
    putTheStationOnAir.mockClear();
    replanTheRunningOrder.mockClear();
    render(<PlanTheStation {...(order === undefined ? {} : { order })} />);
    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Plan' }));
    return user;
};

describe('PlanTheStation', () => {
    it('keeps the show by default, so the safe command is the one a stray press sends', async () => {
        // The two sides are not the same size of decision: one replaces what is coming, the other is
        // heard by everybody listening within a record.
        const user = await open(running());

        await user.click(await screen.findByRole('button', { name: 'Replan' }));

        expect(replanTheRunningOrder).toHaveBeenCalledTimes(1);
        expect(putTheStationOnAir).not.toHaveBeenCalled();
    });

    it('seeds the brief off the running order, so clearing it is a gesture somebody can make', async () => {
        // Seeded on OPEN rather than at mount: this component is mounted with the desk and the
        // order arrives on a poll after it, so an `initialValues` seed shows an empty box on a
        // broadcast that has a brief.
        await open(running());

        expect(await screen.findByDisplayValue('heavy metal hits')).toBeInTheDocument();
    });

    it('sends nothing when the brief was not touched, because absent keeps it and empty clears it', async () => {
        const user = await open(running());

        await user.click(await screen.findByRole('button', { name: 'Replan' }));

        expect(replanTheRunningOrder).toHaveBeenCalledWith({});
    });

    it('starts a new broadcast on the other side of the choice', async () => {
        const user = await open(running());

        await user.click(await screen.findByRole('radio', { name: 'Start a new show' }));
        await user.clear(screen.getByRole('textbox', { name: /Asked to play/ }));
        await user.type(screen.getByRole('textbox', { name: /Asked to play/ }), 'warm and unhurried');
        await user.click(screen.getByRole('button', { name: 'Go on air' }));

        expect(putTheStationOnAir).toHaveBeenCalledWith(expect.objectContaining({ brief: 'warm and unhurried', name: 'warm and unhurried' }));
        expect(replanTheRunningOrder).not.toHaveBeenCalled();
    });

    it('offers no choice when nothing is on, because there is no show to keep', async () => {
        // And it must still be reachable: this is how the station goes on air from the desk, so an
        // operator who has pressed Stop is not left with the playlists page as their only way back.
        const user = await open({ name: '', mode: 'rotation', onEnd: 'extend', source: 'director', items: [] } as StationOrder);

        expect(screen.queryByRole('radio', { name: 'Keep this show' })).not.toBeInTheDocument();

        await user.type(await screen.findByRole('textbox', { name: /Asked to play/ }), 'heavy metal hits');
        await user.click(screen.getByRole('button', { name: 'Go on air' }));

        expect(putTheStationOnAir).toHaveBeenCalledTimes(1);
    });

    it('says nothing about calls when nobody ticked the box', async () => {
        const user = await open(running());

        await user.click(await screen.findByRole('radio', { name: 'Start a new show' }));
        await user.click(screen.getByRole('button', { name: 'Go on air' }));

        expect(putTheStationOnAir).toHaveBeenCalledWith(expect.not.objectContaining({ callins: expect.anything() }));
    });

    it('asks for calls when somebody did', async () => {
        const user = await open(running());

        await user.click(await screen.findByRole('radio', { name: 'Start a new show' }));
        await user.click(screen.getByLabelText('Take calls during this broadcast'));
        await user.click(screen.getByRole('button', { name: 'Go on air' }));

        expect(putTheStationOnAir).toHaveBeenCalledWith(expect.objectContaining({ callins: true }));
    });
});
