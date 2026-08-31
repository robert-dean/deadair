// The desk merges two pages that each drew part of the broadcast, so what is worth testing is the
// merge itself: that all three zones are on one screen, that the transport controls the deleted
// footer used to carry are still reachable, and that an hour of played records does not bury the
// four rows that have not happened yet.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationOrder, StationOrderItem } from '@deadair/sdk';

import { DeskPage } from '../../../src/components/desk/desk.page';
import { measureTheOrderPort } from '../../utils/order.port';
import { playoutStatus, stationSilence } from '../../utils/playout.fixture';
import { stationAir } from '../../utils/station.fixture';
import { render, screen, setupUser, waitFor } from '../../utils/render';

// The table mounts a window of rows sized from the port's rect, and jsdom measures every rect at
// zero — without this, the tbody is empty and the running-order assertions fail against it.
measureTheOrderPort();

const getStationAir = vi.fn();
const getTheRunningOrder = vi.fn();
const getPlayoutStatus = vi.fn();
const readStationAttention = vi.fn();
const skipTheCurrentItem = vi.fn();
const stopPlayout = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            getStationAir: () => getStationAir(),
            getTheRunningOrder: () => getTheRunningOrder(),
            shuffleTheRunningOrder: () => Promise.resolve(order()),
            extendTheRunningOrder: () => Promise.resolve({}),
            replanTheRunningOrder: () => Promise.resolve({}),
            removeARunningOrderItem: () => Promise.resolve(order()),
            recastTheBroadcast: () => Promise.resolve(order()),
        },
        playout: {
            getPlayoutStatus: () => getPlayoutStatus(),
            skipTheCurrentItem: () => skipTheCurrentItem(),
            stopPlayout: () => stopPlayout(),
            startPlayout: () => Promise.resolve(playoutStatus()),
        },
        station: { readStationAttention: () => readStationAttention() },
        personas: { listPersonas: () => Promise.resolve({ personas: [] }) },
        catalog: { rateTrack: () => Promise.resolve({}) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => {
        const path = Object.entries(params ?? {}).reduce((built, [key, value]) => built.replace(`$${key}`, value), to);
        return (
            <a href={path} {...rest}>
                {children}
            </a>
        );
    },
}));

const orderItem = (overrides: Partial<StationOrderItem> = {}): StationOrderItem => ({
    id: 'item-1',
    kind: 'track',
    state: 'planned',
    title: 'Windowlicker',
    artists: ['Aphex Twin'],
    durationMs: 366_000,
    pluginId: 'deadair.spotify',
    externalId: 'track-1',
    ...overrides,
});

/** A broadcast well under way: three behind it, one on air, two still to come. */
const order = (overrides: Partial<StationOrder> = {}): StationOrder => ({
    name: 'Late shift',
    mode: 'rotation',
    onEnd: 'extend',
    source: 'import',
    items: [
        orderItem({ id: 'a', state: 'played', title: 'Xtal' }),
        orderItem({ id: 'b', state: 'played', title: 'Ageispolis' }),
        orderItem({ id: 'c', state: 'skipped', title: 'Green Calx' }),
        orderItem({ id: 'd', state: 'airing', title: 'Windowlicker' }),
        orderItem({ id: 'e', state: 'planned', title: 'Come to Daddy' }),
        orderItem({ id: 'f', state: 'planned', title: 'Flim' }),
    ],
    ...overrides,
});

function arrange(): void {
    getStationAir.mockResolvedValue(stationAir());
    getTheRunningOrder.mockResolvedValue(order());
    getPlayoutStatus.mockResolvedValue(playoutStatus());
    stopPlayout.mockResolvedValue(playoutStatus());
    readStationAttention.mockResolvedValue({
        items: [
            {
                code: 'pluginDown',
                severity: 'failure',
                title: 'The spotify plugin will not start',
                detail: 'Its refresh token was rejected.',
                route: '/plugins/deadair.spotify',
            },
        ],
    });
}

// As `desk.order.test.tsx` already does. Without it a case asserting that a control was NOT pressed
// reads the presses of every case before it, which is how "Stop forgets on its own" failed on a
// call the previous test made.
afterEach(() => {
    vi.clearAllMocks();
});

describe('DeskPage', () => {
    it('answers all three questions on one screen', async () => {
        arrange();
        render(<DeskPage />);

        // What is going out, what needs a person, and what is coming — the three zones that used to
        // be two pages with a click between them. The record on air appears twice by design: once
        // as what is going out, once as its row in the order.
        expect(await screen.findByText('On air now')).toBeInTheDocument();
        expect(screen.getAllByText('Windowlicker').length).toBeGreaterThan(0);
        expect(await screen.findByText('The spotify plugin will not start')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Running order' })).toBeInTheDocument();
    });

    it('keeps the transport controls the footer used to carry', async () => {
        // The permanent strip is gone. Skip and Stop have to have landed somewhere, or this change
        // quietly removed the operator's ability to cut a record.
        arrange();
        render(<DeskPage />);

        expect(await screen.findByRole('button', { name: 'Skip' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    // Stop is the only control here heard by everybody listening, and it sits ten pixels from Skip,
    // which is recoverable. It takes two presses.
    it('arms Stop rather than firing it, and says so by changing what it is called', async () => {
        arrange();
        const user = setupUser();
        render(<DeskPage />);

        await user.click(await screen.findByRole('button', { name: 'Stop' }));

        expect(stopPlayout).not.toHaveBeenCalled();
        expect(await screen.findByRole('button', { name: 'Confirm stop' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Confirm stop' }));
        await waitFor(() => expect(stopPlayout).toHaveBeenCalled());
    });

    it('keeps Skip and Stop exactly where they were once Stop is armed', async () => {
        // Found on the running console: `grow` split the row evenly, which left 46px of text room
        // and clipped "Confirm stop" to "Confirr". Sizing the button to its content fixes the
        // clipping and introduces a worse bug — Skip slides out from under the pointer between the
        // press that arms Stop and the press that fires it, so the second press lands on a control
        // that has moved. The width is therefore fixed and the same in both states.
        arrange();
        const user = setupUser();
        render(<DeskPage />);

        // Geometry only. The colour is meant to change — outline to filled — and asserting the
        // whole `style` attribute would fail on exactly the difference the arming is for.
        const box = (name: string) => {
            const { width, height } = (screen.getByRole('button', { name }) as HTMLElement).style;
            return { width, height };
        };

        await screen.findByRole('button', { name: 'Stop' });
        const stopBefore = box('Stop');
        const skipBefore = box('Skip');
        expect(stopBefore.width).not.toBe('');

        await user.click(screen.getByRole('button', { name: 'Stop' }));

        expect(box('Confirm stop')).toEqual(stopBefore);
        expect(box('Skip')).toEqual(skipBefore);
    });

    it('forgets an armed Stop on its own', async () => {
        // A Stop left armed on a console nobody is looking at is a Stop that fires on the next
        // stray press, which is the thing arming it exists to prevent, arriving a minute later.
        //
        // `shouldAdvanceTime` so the clock still runs for everything else on the page — the desk
        // polls, and a suite that froze time would hang on the first query rather than test this.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            arrange();
            const user = setupUser();
            render(<DeskPage />);

            await user.click(await screen.findByRole('button', { name: 'Stop' }));
            expect(screen.getByRole('button', { name: 'Confirm stop' })).toBeInTheDocument();

            await vi.advanceTimersByTimeAsync(5_000);

            await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
            expect(stopPlayout).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('offers Start rather than Stop once the station has been stood down', async () => {
        // Stop leaves the running order alone so Start can resume it. A desk that only ever offered
        // Stop would strand an operator who had used it.
        arrange();
        getStationAir.mockResolvedValue(stationAir({ active: false }));
        render(<DeskPage />);

        expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });

    it('folds the history away rather than burying what has not happened yet', async () => {
        arrange();
        render(<DeskPage />);

        // The two played and the one skipped are counted, not listed.
        expect(await screen.findByRole('button', { name: /2 played earlier, 1 skipped/ })).toBeInTheDocument();
        expect(screen.queryByText('Xtal')).not.toBeInTheDocument();
        // What is still to come is there — in the up-next line and as its own row.
        expect(screen.getAllByText('Come to Daddy').length).toBeGreaterThan(0);
    });

    it('opens the history when asked, and keeps the broadcast numbering honest', async () => {
        arrange();
        const user = setupUser();
        render(<DeskPage />);

        await user.click(await screen.findByRole('button', { name: /2 played earlier, 1 skipped/ }));

        await waitFor(() => {
            expect(screen.getByText('Xtal')).toBeInTheDocument();
        });
        // Row 4 is the one on air whether or not the history is showing: the fold must not renumber
        // the broadcast under the operator.
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('puts the fix on the row that reports the problem', async () => {
        arrange();
        render(<DeskPage />);

        const action = await screen.findByRole('link', { name: /Plugin/ });
        expect(action).toHaveAttribute('href', '/plugins/deadair.spotify');
    });

    it('says nothing here takes the station off air', async () => {
        // The reassurance is load-bearing rather than decoration: this list is the first thing an
        // operator reads, and it is a list of things that are wrong.
        arrange();
        render(<DeskPage />);

        expect(await screen.findByText(/Nothing here is urgent enough to take the station off air/)).toBeInTheDocument();
    });
});
