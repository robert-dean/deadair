// These were the On-air page's tests. The desk owns every one of these behaviours now — the page
// itself is gone — so they moved rather than being deleted with it.
//
// The state on each item is the point of this page. What is tested is that it says where the
// station has got to without ever claiming an item the player is merely holding is playing — that
// mistake is a track ahead of the stream, and it is what the whole shape exists to prevent — and
// that an item beyond editing is offered no control that could only answer 422.

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { StationOrder, StationOrderItem } from '@deadair/sdk';

import { DeskPage } from '../../../src/components/desk/desk.page';
import { measureTheOrderPort } from '../../utils/order.port';
import { notifyUndoable } from '../../../src/components/shared/notify';
import { playoutStatus, stationSilence } from '../../utils/playout.fixture';
import { stationAir } from '../../utils/station.fixture';
import { render, screen, waitFor } from '../../utils/render';

// The table mounts a window of rows sized from the port's rect, and jsdom measures every rect at
// zero — without this, the tbody is empty and every assertion below fails against it.
measureTheOrderPort();

const getStationAir = vi.fn();
const getTheRunningOrder = vi.fn();
const removeARunningOrderItem = vi.fn();
const addARecordToTheRunningOrder = vi.fn();
const moveARunningOrderItem = vi.fn();
const shuffleTheRunningOrder = vi.fn();
const extendTheRunningOrder = vi.fn();
const replanTheRunningOrder = vi.fn();
const stopPlayout = vi.fn();
const startPlayout = vi.fn();
const rateTrack = vi.fn();
const getPlayoutStatus = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            getStationAir: () => getStationAir(),
            getTheRunningOrder: () => getTheRunningOrder(),
            removeARunningOrderItem: (...args: unknown[]) => removeARunningOrderItem(...args),
            addARecordToTheRunningOrder: (...args: unknown[]) => addARecordToTheRunningOrder(...args),
            moveARunningOrderItem: (...args: unknown[]) => moveARunningOrderItem(...args),
            shuffleTheRunningOrder: () => shuffleTheRunningOrder(),
            extendTheRunningOrder: (...args: unknown[]) => extendTheRunningOrder(...args),
            replanTheRunningOrder: (...args: unknown[]) => replanTheRunningOrder(...args),
            // The format clock rides this page now, behind a fold. Its own cases are in
            // `clock.on.air.test.tsx`; what it needs here is only to not throw.
            listClockBands: () => Promise.resolve({ bands: [], producibleKinds: [] }),
        },
        topics: { listTopics: () => Promise.resolve({ topics: [] }) },
        playout: { stopPlayout: () => stopPlayout(), startPlayout: () => startPlayout(), getPlayoutStatus: () => getPlayoutStatus() },
        catalog: { rateTrack: (...args: unknown[]) => rateTrack(...args) },
        station: { readStationAttention: () => Promise.resolve({ items: [] }) },
        personas: { listPersonas: () => Promise.resolve({ personas: [] }) },
    },
}));

// The href is composed from `to` and `params` rather than stubbed as `#`, so the deep-link cases
// below can assert where a row actually goes rather than only that it is clickable.
// `notifyUndoable` renders through Mantine's `<Notifications />` portal, which nothing under
// `render()` mounts — every other notify call in this suite is asserted the same way, by what it
// was CALLED with rather than by clicking a toast that is not there. `actual` keeps `notifySaved`
// and friends real, since nothing here is testing them.
vi.mock('../../../src/components/shared/notify', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../src/components/shared/notify')>()),
    notifyUndoable: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        params,
        search,
        children,
        ...rest
    }: {
        to: string;
        params?: Record<string, string>;
        search?: Record<string, string>;
        children?: ReactNode;
    }) => {
        const path = Object.entries(params ?? {}).reduce((built, [key, value]) => built.replace(`$${key}`, value), to);
        const query = new URLSearchParams(search ?? {}).toString();
        return (
            <a href={query === '' ? path : `${path}?${query}`} {...rest}>
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

beforeEach(() => {
    // The desk draws the transport panel above the running order, so every case needs a reading
    // even when it is asserting about the order. The On-air page these tests came from only used
    // the transport for its silence panel, so most of them never set one.
    getPlayoutStatus.mockResolvedValue(playoutStatus());
    getStationAir.mockResolvedValue(stationAir());
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('DeskPage: the running order and the broadcast controls', () => {
    it('draws where each item has got to, and calls a handed item handed rather than playing', async () => {
        // The pusher runs a lead ahead of the listener by design, so an item the player is holding
        // may be two records from being heard. A console that called it "playing" would be a track
        // ahead of the stream, which is exactly the bug this shape removes.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);

        expect(await screen.findByText('Late shift')).toBeInTheDocument();
        // Once, not twice: the station's own tally moved into the header, so the only "on air" on
        // this page is the item the player says is producing audio.
        expect(screen.getAllByText('on air')).toHaveLength(1);
        expect(screen.getByText('handed over')).toBeInTheDocument();

        // What is behind us is folded on the desk, so it is a count until asked for. Opening it is
        // part of the claim: the states still have to be told apart once they are on screen.
        await userEvent.click(screen.getByRole('button', { name: /1 played earlier/ }));
        expect(await screen.findByText('played')).toBeInTheDocument();
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

        render(<DeskPage />);
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

        render(<DeskPage />);
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

        render(<DeskPage />);
        await screen.findByText('Late shift');

        await userEvent.click(screen.getByRole('radio', { name: 'Dislike Xtal' }));

        await waitFor(() => {
            expect(rateTrack).toHaveBeenCalledWith('trk_9', { rating: 'disliked' });
        });
    });

    // The running order is where an operator forms an opinion about a record, so it has to be the
    // way into everything that record has accumulated rather than a dead end they retype into the
    // catalog's search box.
    it('takes a row to the record, the artist and the release behind it', async () => {
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({
                        id: 'item-1',
                        state: 'airing',
                        title: 'Windowlicker',
                        artists: ['Aphex Twin'],
                        album: 'Come to Daddy EP',
                        trackId: 'trk_1',
                        artistId: 'art_1',
                        albumId: 'alb_1',
                    }),
                ],
            }),
        );
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByRole('link', { name: 'Windowlicker' })).toHaveAttribute('href', '/catalog/tracks/trk_1');
        // The mock router below has no `stripSearchParams`, so the defaults a real console
        // strips back out of the URL are spelled out here. Verified in the browser: the href
        // this actually renders is the short one.
        expect(screen.getByRole('link', { name: 'Aphex Twin' })).toHaveAttribute(
            'href',
            '/catalog/artists/art_1?page=0&sortBy=name&sort=asc&pageSize=50',
        );
    });

    // The station can air a record it never ingested, and a record can be ingested outside any
    // release. Neither has a page, so neither may be drawn as a link that answers 404.
    it('draws a record the catalog has never seen as words rather than as a link', async () => {
        getTheRunningOrder.mockResolvedValue(
            order({ items: [orderItem({ id: 'item-1', state: 'planned', title: 'Uningested', artists: ['Nobody'] })] }),
        );
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByText('Uningested')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Uningested' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Nobody' })).not.toBeInTheDocument();
    });

    // A break's title goes somewhere else entirely: what an operator wants from a row that is the
    // station talking is what it said, and every attempt at saying it.
    it('takes a break to the words it was written from', async () => {
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({ id: 'item-1', kind: 'segment', state: 'planned', title: 'Talk break', artists: [], segmentId: 'seg_1' }),
                    orderItem({ id: 'item-2', kind: 'segment', state: 'planned', title: 'A segment the library no longer holds', artists: [] }),
                ],
            }),
        );
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByRole('link', { name: 'Talk break' })).toHaveAttribute('href', '/voice?tab=said&segment=seg_1&persona=');
        expect(screen.queryByRole('link', { name: 'A segment the library no longer holds' })).not.toBeInTheDocument();
    });

    it('offers no way to drop anything but what is still planned', async () => {
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
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

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Drop Ageispolis' }));

        await waitFor(() => expect(removeARunningOrderItem).toHaveBeenCalledWith('item-4'));
        await waitFor(() => expect(screen.queryByText('Ageispolis')).not.toBeInTheDocument());
    });

    // Undo's whole reason for existing: a track is spliced out of the order entirely when it is
    // dropped, so without a way back an operator who dropped the wrong row has no recourse but
    // Shuffle or a replan — both of which change everything else too.
    it('offers to put a dropped record back, at the position it held', async () => {
        const withCatalogTrack = order({
            items: [...order().items.slice(0, 3), orderItem({ id: 'item-4', state: 'planned', title: 'Ageispolis', trackId: 'track-ageispolis' })],
        });
        getTheRunningOrder.mockResolvedValue(withCatalogTrack);
        removeARunningOrderItem.mockResolvedValue(order({ items: withCatalogTrack.items.slice(0, 3) }));
        addARecordToTheRunningOrder.mockResolvedValue(withCatalogTrack);

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Drop Ageispolis' }));
        await waitFor(() => expect(removeARunningOrderItem).toHaveBeenCalled());

        expect(notifyUndoable).toHaveBeenCalledWith(
            expect.stringContaining('Ageispolis'),
            expect.objectContaining({ label: 'Put it back', onUndo: expect.any(Function) }),
        );

        // The offer itself, exercised: calling what the toast's button would call reaches the API
        // with the position item 4 held (index 3) in the order the page had drawn when it was
        // dropped, not the position it would hold in whatever the order has become since.
        const [, action] = vi.mocked(notifyUndoable).mock.calls[0]!;
        action.onUndo();
        await waitFor(() => expect(addARecordToTheRunningOrder).toHaveBeenCalledWith({ trackId: 'track-ageispolis', atIndex: 3 }));
    });

    it('offers no way back for a segment, which drop marks rather than removes', async () => {
        // `orderItem`'s default `kind` is `track`, so a segment case has to say so — and a segment
        // carries no `trackId`, which is the field the undo offer is actually keyed on.
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    ...order().items.slice(0, 3),
                    orderItem({
                        id: 'item-4',
                        state: 'planned',
                        title: 'Talk break',
                        kind: 'segment',
                        artists: [],
                        pluginId: undefined,
                        externalId: undefined,
                    }),
                ],
            }),
        );
        removeARunningOrderItem.mockResolvedValue(order({ items: order().items.slice(0, 3) }));

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Drop Talk break' }));

        await waitFor(() => expect(removeARunningOrderItem).toHaveBeenCalled());
        expect(notifyUndoable).not.toHaveBeenCalled();
    });

    // The count never answered the question an operator actually has, which is whether they can go
    // to bed. Twenty-one items is forty minutes or two hours and the count does not say which.
    it('says when the order runs out, and what the station does then', async () => {
        getTheRunningOrder.mockResolvedValue(order());

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByText(/The order runs dry at about/)).toBeInTheDocument();
        // Read off `onEnd` rather than assumed. The fixture's order is set to extend.
        expect(screen.getByText(/tops itself up/)).toBeInTheDocument();
    });

    it('promises no refill to a station set to go off air when the order runs out', async () => {
        // The one setting worth waking up for, and the one the mock's own copy would have got
        // wrong: "it tops itself up" is true of exactly one of the three values `onEnd` takes.
        getTheRunningOrder.mockResolvedValue(order({ onEnd: 'stop' }));

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByText(/goes off air then/)).toBeInTheDocument();
    });

    it('projects nothing while the station is not producing audio', async () => {
        // Off air the order is not running down at all, so a clock time would be projected from a
        // broadcast that is not happening. The panel above already says the station is stood down.
        getTheRunningOrder.mockResolvedValue(order());
        getPlayoutStatus.mockResolvedValue(playoutStatus({ nowPlaying: undefined, onAir: false, silence: stationSilence('stoodDown') }));
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.queryByText(/The order runs dry/)).not.toBeInTheDocument();
    });

    // The only way to reorder the hour that is not Shuffle, which reorders all of it.
    it('offers to play next only what is still planned, and not what is already at the front', async () => {
        // The order runs played, airing, handed, planned — so the one planned row IS the front of
        // what can still be moved, and there is nowhere for it to go.
        getTheRunningOrder.mockResolvedValue(order());

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.queryByRole('button', { name: 'Play Ageispolis next' })).not.toBeInTheDocument();
        // Nothing beyond editing gets one either: the player is holding these or they are behind us,
        // and the API refuses any position inside the committed head rather than clamping it.
        expect(screen.queryByRole('button', { name: 'Play Come to Daddy next' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Play Windowlicker next' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Play Xtal next' })).not.toBeInTheDocument();
    });

    it('moves a record to the front of what the player is not already holding', async () => {
        // The index sent is the FIRST planned position rather than 0. Everything before it has been
        // handed over or is behind us, and `lineup.move` refuses a position inside that head — so a
        // console that sent 0 would have its edit rejected on every broadcast in progress.
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({ id: 'item-1', state: 'played', title: 'Xtal' }),
                    orderItem({ id: 'item-2', state: 'airing', title: 'Windowlicker' }),
                    orderItem({ id: 'item-3', state: 'handed', title: 'Come to Daddy' }),
                    orderItem({ id: 'item-4', state: 'planned', title: 'Ageispolis' }),
                    orderItem({ id: 'item-5', state: 'planned', title: 'Pulsewidth' }),
                ],
            }),
        );
        moveARunningOrderItem.mockResolvedValue(order());

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Play Pulsewidth next' }));

        await waitFor(() => expect(moveARunningOrderItem).toHaveBeenCalledWith('item-5', { toIndex: 3 }));
    });

    it('says so when a move is refused, rather than looking like nothing happened', async () => {
        // The race an operator cannot see coming: the player takes the front of the order between
        // the row being drawn and the row being clicked, and the position that was legal is not any
        // more. A silent no-op there reads as a broken button.
        getTheRunningOrder.mockResolvedValue(
            order({
                items: [
                    orderItem({ id: 'item-1', state: 'airing', title: 'Windowlicker' }),
                    orderItem({ id: 'item-2', state: 'planned', title: 'Ageispolis' }),
                    orderItem({ id: 'item-3', state: 'planned', title: 'Pulsewidth' }),
                ],
            }),
        );
        moveARunningOrderItem.mockRejectedValue(new Error('that position has already been handed to the player'));

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Play Pulsewidth next' }));

        expect(await screen.findByText(/could not be moved/i)).toBeInTheDocument();
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

        render(<DeskPage />);

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

        render(<DeskPage />);

        expect(await screen.findByText('model')).toBeInTheDocument();
        expect(screen.getByText('deterministic')).toBeInTheDocument();
    });

    it('says nothing about a writer for a recording somebody made', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ id: 'seg-1', kind: 'segment', title: 'Top of the hour', artists: [] })] }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);

        expect(await screen.findByText('Top of the hour')).toBeInTheDocument();
        expect(screen.queryByText('deterministic')).not.toBeInTheDocument();
    });

    it('offers Start instead of Stop once the station is stood down, on the order it kept', async () => {
        // The gap this closes: Stop deliberately leaves the running order alone so that Start can
        // resume it, and this page offered no Start at all — an operator who stopped a station with
        // a full order was shown Shuffle, Extend and Stop again, with no way back on air from the
        // one page whose whole subject is the running order.
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ id: 'item-1', title: 'Windowlicker' })] }));
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Start' }));

        expect(startPlayout).toHaveBeenCalledOnce();
    });

    it('offers Stop rather than Start while the station is on air', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ id: 'item-1', title: 'Windowlicker' })] }));
        getStationAir.mockResolvedValue(stationAir({ active: true }));

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    });

    it('still offers Shuffle and Plan while stood down, because an order can be prepared off air', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ id: 'item-1' }), orderItem({ id: 'item-2', title: 'Xtal' })] }));
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByRole('button', { name: 'Shuffle' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Plan' })).toBeEnabled();
    });

    it('offers to take a call while there is a broadcast to put one inside', async () => {
        // It belongs on this page rather than on Productions because it inherits THIS show: the
        // broadcast's host presents the call and the broadcast's brief is what it is about.
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ id: 'item-1' }), orderItem({ id: 'item-2', title: 'Xtal' })] }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
        await screen.findByText('Late shift');

        expect(screen.getByRole('button', { name: 'Take a call' })).toBeEnabled();
    });

    it('will not offer to shuffle a tail with nothing left in it', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ state: 'airing' })] }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);

        expect(await screen.findByRole('button', { name: 'Shuffle' })).toBeDisabled();
    });

    it('offers to plan a tail that is too short to shuffle, because a dry order is worth replanning', async () => {
        // The one place the two buttons deliberately disagree. Shuffling one item cannot change
        // anything; replanning is exactly what an operator wants when the hour has run out.
        getTheRunningOrder.mockResolvedValue(order({ items: [orderItem({ state: 'airing' })] }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);

        expect(await screen.findByRole('button', { name: 'Shuffle' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Plan' })).toBeEnabled();
    });

    it('replans against a new brief, and seeds the box with what the broadcast is already carrying', async () => {
        getTheRunningOrder.mockResolvedValue(order({ brief: 'ambient only' }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Plan' }));

        // Keeping the show is the default side, so this is what opens without choosing anything.
        const box = await screen.findByRole('textbox', { name: /Asked to play/ });
        expect(box).toHaveValue('ambient only');

        await userEvent.clear(box);
        await userEvent.type(box, 'heavy metal hits');
        await userEvent.click(screen.getByRole('button', { name: 'Replan' }));

        await waitFor(() => expect(replanTheRunningOrder).toHaveBeenCalledWith({ brief: 'heavy metal hits' }));
    });

    it('says nothing about the brief when the operator left it alone', async () => {
        // Absent keeps what the broadcast was asked for; an empty string CLEARS it. Handing the
        // untouched box back would turn "I did not touch this" into a rewrite of the same words.
        getTheRunningOrder.mockResolvedValue(order({ brief: 'ambient only' }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Plan' }));
        await screen.findByRole('textbox', { name: /Asked to play/ });

        await userEvent.click(screen.getByRole('button', { name: 'Replan' }));

        await waitFor(() => expect(replanTheRunningOrder).toHaveBeenCalledWith({}));
    });

    it('offers an empty station both ways on air, and Plan is one of them', async () => {
        // Neither needs anything prepared: a brief is programmed against from nothing, and a
        // playlist is READ at the moment the station goes on.
        //
        // Plan being drawn at all is the half worth pinning. The whole button row used to be gated
        // on the order having ITEMS, and the briefing box that is now inside Plan was drawn outside
        // that gate for exactly this reason: Stop leaves the running order alone rather than
        // emptying it, so an operator who had ever been on air needed a way back that was not the
        // playlists page.
        getTheRunningOrder.mockResolvedValue(order({ items: [], name: '' }));
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<DeskPage />);

        expect(await screen.findByRole('button', { name: 'Plan' })).toBeEnabled();
        expect(screen.getByText('Browse playlists')).toBeInTheDocument();
    });

    it('will not start a broadcast with nothing asked for', async () => {
        getTheRunningOrder.mockResolvedValue(order({ items: [], name: '' }));
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Plan' }));

        expect(await screen.findByRole('button', { name: 'Go on air' })).toBeDisabled();
    });

    it('says what starting a new show costs, on the side that costs it', async () => {
        // The two sides of the choice are not the same size of decision: one replaces what is
        // coming and the other is heard by everybody listening within a record. A segmented control
        // draws them as peers, so the sentence is what stops them reading as peers.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<DeskPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Plan' }));

        expect(screen.queryByText(/starts a new broadcast/)).not.toBeInTheDocument();

        await userEvent.click(await screen.findByRole('radio', { name: 'Start a new show' }));

        expect(screen.getByText(/starts a new broadcast/)).toBeInTheDocument();
    });

    it('shows the brief that is still steering a broadcast', async () => {
        // It is not a label: every refill for the rest of this broadcast is programmed against it,
        // so an operator wondering why the station keeps choosing what it chooses is looking at
        // the answer.
        getTheRunningOrder.mockResolvedValue(order({ brief: 'heavy metal hits' }));
        getStationAir.mockResolvedValue(stationAir());

        render(<DeskPage />);

        expect(await screen.findByText('asked for: heavy metal hits')).toBeInTheDocument();
    });

    it('says when the station is silent on purpose', async () => {
        // In `audience` mode a full running order with nobody connected is silence by design, and
        // an operator staring at a quiet mount needs the console to say so.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir({ airMode: 'audience' }));

        render(<DeskPage />);

        expect(await screen.findByText('when somebody is listening')).toBeInTheDocument();
    });

    it('names the gate that is keeping the station quiet', async () => {
        // The question an operator comes to this page with. It reads the transport poll the
        // strip already runs, so the page and the strip cannot disagree about the same station.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());
        getPlayoutStatus.mockResolvedValue(playoutStatus({ silence: stationSilence('streamUnreachable') }));

        render(<DeskPage />);

        expect(await screen.findByText('The stream is not reachable')).toBeInTheDocument();
    });

    it('lists what it ruled out, which is why this is a panel and not a tooltip', async () => {
        // An operator chasing silence is deciding where to look next, and the places they do not
        // have to look are most of that decision.
        getTheRunningOrder.mockResolvedValue(order());
        getStationAir.mockResolvedValue(stationAir());
        getPlayoutStatus.mockResolvedValue(playoutStatus({ silence: stationSilence('noProgramme') }));

        render(<DeskPage />);

        expect(await screen.findByText('Ruled out')).toBeInTheDocument();
        expect(screen.getByText('The stream is not reachable')).toBeInTheDocument();
    });
});
