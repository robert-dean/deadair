// The transport is the one thing on screen that claims to describe a live
// broadcast, so most of what is tested here is what it REFUSES to show: no clock
// when the decoder did not report one, no commands when the stream cannot take
// them, and no pretence that a truncated running order is the whole of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { hasTransportToShow, TransportBar } from '../../../src/components/playout/transport.bar';
import { playoutItem, playoutStatus } from '../../utils/playout.fixture';
import { render, screen } from '../../utils/render';

const skip = vi.fn();
const stop = vi.fn();

vi.mock('../../../src/api/playout.queries', () => ({
    useSkipCurrent: () => ({ mutate: skip, isPending: false }),
    useStopPlayout: () => ({ mutate: stop, isPending: false }),
}));

describe('hasTransportToShow', () => {
    it('says nothing while the station is idle and the stream is fine', () => {
        // The one state with nothing to report. A permanent empty strip under every
        // page is a cost with no reading behind it.
        expect(hasTransportToShow(playoutStatus({ nowPlaying: undefined, upNext: [], queuedCount: 0 }))).toBe(false);
    });

    it('speaks up when the stream is unreachable, even with nothing queued', () => {
        // "Nothing is playing" and "nothing CAN play" look identical otherwise.
        expect(hasTransportToShow(playoutStatus({ nowPlaying: undefined, upNext: [], queuedCount: 0, streamUp: false }))).toBe(true);
    });

    it('is false before the first reading has arrived', () => {
        expect(hasTransportToShow(undefined)).toBe(false);
    });
});

describe('TransportBar', () => {
    const renderBar = (status = playoutStatus(), expanded = false, onToggleExpanded = vi.fn()) =>
        render(<TransportBar status={status} expanded={expanded} onToggleExpanded={onToggleExpanded} />);

    it('names what is on air and how far into it the station is', () => {
        renderBar();

        expect(screen.getByText('Windowlicker')).toBeInTheDocument();
        expect(screen.getByText('Aphex Twin')).toBeInTheDocument();
        // 6:06 long with 2:00 left, so four minutes in.
        expect(screen.getByText('4:06')).toBeInTheDocument();
        expect(screen.getByText('-2:00')).toBeInTheDocument();
    });

    it('shows no clock at all when the decoder could not say', () => {
        // An elapsed time extrapolated from a start time would be a moving,
        // confident lie, which is worse than an absent one.
        renderBar(playoutStatus({ nowPlaying: { item: playoutItem(), startedAt: 1_700_000_000_000 } }));

        expect(screen.queryByLabelText('Track progress')).not.toBeInTheDocument();
        expect(screen.queryByText(/^-\d+:\d\d$/)).not.toBeInTheDocument();
    });

    it('says why nothing is airing when the stream cannot be reached', () => {
        renderBar(playoutStatus({ streamUp: false, nowPlaying: undefined }));

        expect(screen.getByText('The stream is not reachable, so nothing can go to air.')).toBeInTheDocument();
        expect(screen.getByLabelText('Skip this track')).toBeDisabled();
    });

    it('will not offer a skip with nothing on air', () => {
        renderBar(playoutStatus({ nowPlaying: undefined }));

        expect(screen.getByLabelText('Skip this track')).toBeDisabled();
    });

    it('cuts the current track on demand', async () => {
        renderBar();

        await userEvent.click(screen.getByLabelText('Skip this track'));

        expect(skip).toHaveBeenCalledOnce();
    });

    it('keeps the next track in the strip only while the panel is shut', () => {
        const { rerender } = renderBar();
        expect(screen.getByText(/^Next: Come to Daddy/)).toBeInTheDocument();

        rerender(<TransportBar status={playoutStatus()} expanded onToggleExpanded={vi.fn()} />);

        expect(screen.queryByText(/^Next: /)).not.toBeInTheDocument();
    });

    it('asks the shell to expand rather than expanding itself', async () => {
        // The shell reserves the footer height, so it owns the flag.
        const onToggleExpanded = vi.fn();
        renderBar(playoutStatus(), false, onToggleExpanded);

        await userEvent.click(screen.getByLabelText('Expand the transport'));

        expect(onToggleExpanded).toHaveBeenCalledOnce();
    });

    it('shows the running order and where the stream is going once expanded', () => {
        renderBar(
            playoutStatus({
                upNext: [playoutItem({ id: 'item-2', title: 'Come to Daddy' }), playoutItem({ id: 'item-3', title: 'Xtal' })],
                queuedCount: 12,
            }),
            true,
        );

        expect(screen.getByText('Up next')).toBeInTheDocument();
        expect(screen.getByText('Xtal')).toBeInTheDocument();
        // The API caps what it sends; the shortfall is stated rather than hidden.
        expect(screen.getByText('+10 more in the running order')).toBeInTheDocument();
        expect(screen.getByText('on air')).toBeInTheDocument();
        expect(screen.getByText('/live.mp3')).toBeInTheDocument();
    });

    it('offers exactly one stop, whichever state it is in', async () => {
        // Two controls for one irreversible-sounding command is one more thing to be
        // sure about mid-broadcast.
        const { rerender } = renderBar();
        expect(screen.getByLabelText('Stop playout')).toBeInTheDocument();

        rerender(<TransportBar status={playoutStatus()} expanded onToggleExpanded={vi.fn()} />);

        expect(screen.queryByLabelText('Stop playout')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Stop playout' }));
        expect(stop).toHaveBeenCalledOnce();
    });

    it('shows the cover of what is on air', () => {
        renderBar(playoutStatus({ nowPlaying: { item: playoutItem({ artworkUrl: 'art/asset-1' }), startedAt: 1 } }));

        expect(screen.getByRole('img', { name: 'Windowlicker' })).toHaveAttribute('src', '/api/art/asset-1');
    });

    it('leaves the artwork square out entirely while nothing is on air', () => {
        // The placeholder next to "Starting…" reads as a second thing being wrong,
        // rather than as art the station simply does not hold.
        renderBar(playoutStatus({ nowPlaying: undefined }));

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('Starting…')).toBeInTheDocument();
    });

    it('names the album only with the panel open, where there is room for it', () => {
        const status = playoutStatus({ nowPlaying: { item: playoutItem({ album: 'Windowlicker', year: 1999 }), startedAt: 1 } });

        const { rerender } = renderBar(status);
        expect(screen.queryByText(/1999/)).not.toBeInTheDocument();

        rerender(<TransportBar status={status} expanded onToggleExpanded={vi.fn()} />);
        expect(screen.getByText('Windowlicker (1999)')).toBeInTheDocument();
    });

    it('says what an empty running order means rather than showing a blank list', () => {
        renderBar(playoutStatus({ upNext: [], queuedCount: 0 }), true);

        expect(screen.getByText(/deadair stops driving and the station goes off air/)).toBeInTheDocument();
    });
});

describe('TransportBar clock', () => {
    // The station is only read every couple of seconds. A clock that moved only on
    // those readings would visibly jump; one that kept counting past a track change
    // would be describing a track nobody is hearing.
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('carries the clock forward between readings', () => {
        render(<TransportBar status={playoutStatus()} expanded={false} onToggleExpanded={vi.fn()} />);
        expect(screen.getByText('-2:00')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(2_000);
        });

        expect(screen.getByText('-1:58')).toBeInTheDocument();
        expect(screen.getByText('4:08')).toBeInTheDocument();
    });

    it('restarts from the new reading when the track changes', () => {
        const { rerender } = render(<TransportBar status={playoutStatus()} expanded={false} onToggleExpanded={vi.fn()} />);
        act(() => {
            vi.advanceTimersByTime(4_000);
        });
        expect(screen.getByText('-1:56')).toBeInTheDocument();

        const next = playoutStatus({
            nowPlaying: { item: playoutItem({ id: 'item-2', title: 'Come to Daddy', durationMs: 250_000 }), startedAt: 1, remainingMs: 250_000 },
        });
        rerender(<TransportBar status={next} expanded={false} onToggleExpanded={vi.fn()} />);

        expect(screen.getByText('-4:10')).toBeInTheDocument();
        expect(screen.getByText('0:00')).toBeInTheDocument();
    });
});
