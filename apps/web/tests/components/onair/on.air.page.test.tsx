// The state on each item is the point of this page. What is tested is that it says where the
// station has got to without ever claiming an item the player is merely holding is playing — that
// mistake is a track ahead of the stream, and it is what the whole shape exists to prevent — and
// that an item beyond editing is offered no control that could only answer 422.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { StationOrder, StationOrderItem } from '@deadair/sdk';

import { OnAirPage } from '../../../src/components/onair/on.air.page';
import { playoutStatus, stationSilence } from '../../utils/playout.fixture';
import { stationAir } from '../../utils/station.fixture';
import { render, screen, waitFor } from '../../utils/render';

const getStationAir = vi.fn();
const getTheRunningOrder = vi.fn();
const removeARunningOrderItem = vi.fn();
const shuffleTheRunningOrder = vi.fn();
const extendTheRunningOrder = vi.fn();
const stopPlayout = vi.fn();
const rateTrack = vi.fn();
const getPlayoutStatus = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            getStationAir: () => getStationAir(),
            getTheRunningOrder: () => getTheRunningOrder(),
            removeARunningOrderItem: (...args: unknown[]) => removeARunningOrderItem(...args),
            shuffleTheRunningOrder: () => shuffleTheRunningOrder(),
            extendTheRunningOrder: (...args: unknown[]) => extendTheRunningOrder(...args),
        },
        playout: { stop: () => stopPlayout(), getPlayoutStatus: () => getPlayoutStatus() },
        catalog: { rateTrack: (...args: unknown[]) => rateTrack(...args) },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
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

/** A running order part way through: one played, one on air, one handed over, one still to come. */
const order = (overrides: Partial<StationOrder> = {}): StationOrder => ({
    name: 'Late shift',
    mode: 'rotation',
    onEnd: 'extend',
    source: 'import',
    items: [
        orderItem({ id: 'item-1', state: 'played', title: 'Xtal' }),
        orderItem({ id: 'item-2', state: 'airing', title: 'Windowlicker' }),
        orderItem({ id: 'item-3', state: 'handed', title: 'Come to Daddy' }),
        orderItem({ id: 'item-4', state: 'planned', title: 'Ageispolis' }),
    ],
    ...overrides,
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('OnAirPage', () => {
    it('draws where each item has got to, and calls a handed item handed rather than playing', async () => {
        // The pusher runs a lead ahead of the listener by design, so an item the player is holding
        // may be two records from being heard. A console that called it "playing" would be a track
        // ahead of the stream, which is exactly the bug this shape removes.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);

        expect(await screen.findByText('Late shift')).toBeInTheDocument();
        // Twice: the station badge and the item the player says is producing audio.
        expect(screen.getAllByText('on air')).toHaveLength(2);
        expect(screen.getByText('handed over')).toBeInTheDocument();
        expect(screen.getByText('played')).toBeInTheDocument();
        expect(screen.getByText(/1 still to come/)).toBeInTheDocument();
    });

    it('calls a break the operator cut removed rather than skipped', async () => {
        // The two are opposite facts and used to be one word. `skipped` is the station reaching
        // an item and passing over it, which is something going wrong; a cut is the operator's own
        // edit, and it stays in the order only so the station does not plant another break into
        // the same slot.
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({ id: 'item-1', state: 'airing', title: 'Windowlicker' }),
                    orderItem({ id: 'item-2', state: 'removed', kind: 'segment', title: 'Talk break' }),
                    orderItem({ id: 'item-3', state: 'skipped', kind: 'segment', title: 'Station ident' }),
                ],
            }),
        );
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);
        await screen.findByText('Late shift');

        expect(screen.getByText('removed')).toBeInTheDocument();
        expect(screen.getByText('skipped')).toBeInTheDocument();
        // Neither is still the operator's to act on.
        expect(screen.queryByRole('button', { name: 'Drop Talk break' })).not.toBeInTheDocument();
    });

    // The running order is where an opinion actually forms: the operator is hearing the record.
    it('rates the record that is airing, and offers nothing to rate on a segment or on a record the catalog has never seen', async () => {
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({ id: 'item-1', state: 'airing', title: 'Windowlicker', trackId: 'trk_1', rating: 'neutral' }),
                    orderItem({ id: 'item-2', state: 'planned', kind: 'segment', title: 'Talk break' }),
                    orderItem({ id: 'item-3', state: 'planned', title: 'Uningested' }),
                ],
            }),
        );
        getStationAir.mockResolvedValue(stationAir());
        rateTrack.mockResolvedValue({ id: 'trk_1', title: 'Windowlicker', rating: 'liked' });

        render(<OnAirPage />);
        await screen.findByText('Late shift');

        expect(screen.queryByRole('radio', { name: 'Like Talk break' })).not.toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: 'Like Uningested' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('radio', { name: 'Like Windowlicker' }));

        await waitFor(() => {
            expect(rateTrack).toHaveBeenCalledWith('trk_1', { rating: 'liked' });
        });
    });

    // A rating is about the work rather than about this item's turn, so unlike every other control
    // on the page it survives the record having already been played.
    it('still rates a record that has already aired', async () => {
        getTheRunningOrder.mockResolvedValue(
            order({ items: [orderItem({ id: 'item-1', state: 'played', title: 'Xtal', trackId: 'trk_9', rating: 'neutral' })] }),
        );
        getStationAir.mockResolvedValue(stationAir());
        rateTrack.mockResolvedValue({ id: 'trk_9', title: 'Xtal', rating: 'disliked' });

        render(<OnAirPage />);
        await screen.findByText('Late shift');

        await userEvent.click(screen.getByRole('radio', { name: 'Dislike Xtal' }));

        await waitFor(() => {
            expect(rateTrack).toHaveBeenCalledWith('trk_9', { rating: 'disliked' });
        });
    });

    it('offers no way to drop anything but what is still planned', async () => {
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);
        await screen.findByText('Late shift');

        expect(screen.getByRole('button', { name: 'Drop Ageispolis' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Drop Windowlicker' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Drop Come to Daddy' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Drop Xtal' })).not.toBeInTheDocument();
    });

    it('drops an item and draws the order the station answered with', async () => {
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());
        removeARunningOrderItem.mockResolvedValue(order({ items: order().items.slice(0, 3) }));

        render(<OnAirPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Drop Ageispolis' }));

        await waitFor(() => expect(removeARunningOrderItem).toHaveBeenCalledWith('item-4'));
        await waitFor(() => expect(screen.queryByText('Ageispolis')).not.toBeInTheDocument());
    });

    it('shows a segment the station will pass over rather than hiding it', async () => {
        // The station SKIPS a segment with no audio when it comes round. An operator reading the
        // order has to be able to see which items will not be heard, and why.
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({
                        id: 'seg-1',
                        kind: 'segment',
                        title: 'Talk break',
                        artists: [],
                        playable: false,
                        segmentState: 'failed',
                        segmentError: 'nothing could write it',
                    }),
                ],
            }),
        );
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);

        expect(await screen.findByText('Talk break')).toBeInTheDocument();
        expect(screen.getByText('will skip')).toBeInTheDocument();
    });

    it('says which writer produced a break', async () => {
        // A model that degrades to the station's own phrasings on every single break looks exactly
        // like a model that is working, unless the row says which one spoke.
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({ id: 'seg-1', kind: 'segment', title: 'Talk break', artists: [], segmentWriter: 'model' }),
                    orderItem({ id: 'seg-2', kind: 'segment', title: 'Another break', artists: [], segmentWriter: 'deterministic' }),
                ],
            }),
        );
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);

        expect(await screen.findByText('model')).toBeInTheDocument();
        expect(screen.getByText('deterministic')).toBeInTheDocument();
    });

    it('says nothing about a writer for a recording somebody made', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ id: 'seg-1', kind: 'segment', title: 'Top of the hour', artists: [] })] }));
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);

        expect(await screen.findByText('Top of the hour')).toBeInTheDocument();
        expect(screen.queryByText('deterministic')).not.toBeInTheDocument();
    });

    it('will not offer to shuffle a tail with nothing left in it', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ state: 'airing' })] }));
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);

        expect(await screen.findByRole('button', { name: 'Shuffle' })).toBeDisabled();
    });

    it('offers an empty station both ways on air, the brief first', async () => {
        // Neither needs anything prepared: a brief is programmed against from nothing, and a
        // playlist is READ at the moment the station goes on. The brief is first because it is the
        // one that needs no material at all.
        getTheRunningOrder.mockResolvedValue(order({ items: [], name: '' }));
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<OnAirPage />);

        expect(await screen.findByText('Tell the station what to play')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go on air' })).toBeDisabled();
        expect(screen.getByText('Browse playlists')).toBeInTheDocument();
    });

    it('still offers a brief with a running order up, and says it replaces one', async () => {
        // The box used to live inside the empty state, and Stop does not empty the running order:
        // it stands the station down and leaves the order for a resume. So an operator who had ever
        // been on air could not reach this again without dropping every item by hand.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<OnAirPage />);

        expect(await screen.findByText('Tell the station what to play')).toBeInTheDocument();
        expect(screen.getByText(/starts a new broadcast/)).toBeInTheDocument();
        // The playlist card stays behind: it answers having nothing on, and the nav already has it.
        expect(screen.queryByText('Browse playlists')).not.toBeInTheDocument();
    });

    it('shows the brief that is still steering a broadcast', async () => {
        // It is not a label: every refill for the rest of this broadcast is programmed against it,
        // so an operator wondering why the station keeps choosing what it chooses is looking at
        // the answer.
        getTheRunningOrder.mockResolvedValue(order({ brief: 'heavy metal hits' }));
        getStationAir.mockResolvedValue(stationAir());

        render(<OnAirPage />);

        expect(await screen.findByText('asked for: heavy metal hits')).toBeInTheDocument();
    });

    it('says when the station is silent on purpose', async () => {
        // In `audience` mode a full running order with nobody connected is silence by design, and
        // an operator staring at a quiet mount needs the console to say so.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir({ airMode: 'audience' }));

        render(<OnAirPage />);

        expect(await screen.findByText('when somebody is listening')).toBeInTheDocument();
    });

    it('names the gate that is keeping the station quiet', async () => {
        // The question an operator comes to this page with. It reads the transport poll the
        // strip already runs, so the page and the strip cannot disagree about the same station.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());
        getPlayoutStatus.mockResolvedValue(playoutStatus({ silence: stationSilence('streamUnreachable') }));

        render(<OnAirPage />);

        expect(await screen.findByText('The stream is not reachable')).toBeInTheDocument();
    });

    it('lists what it ruled out, which is why this is a panel and not a tooltip', async () => {
        // An operator chasing silence is deciding where to look next, and the places they do not
        // have to look are most of that decision.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());
        getPlayoutStatus.mockResolvedValue(playoutStatus({ silence: stationSilence('noProgramme') }));

        render(<OnAirPage />);

        expect(await screen.findByText('Ruled out')).toBeInTheDocument();
        expect(screen.getByText('The stream is not reachable')).toBeInTheDocument();
    });
});
