// The transport is the one thing on screen that claims to describe a live
// broadcast, so most of what is tested here is what it REFUSES to show: no clock
// when the decoder did not report one, no commands when the stream cannot take
// them, and no pretence that a truncated running order is the whole of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { StreamConfigWarning } from '@deadair/sdk';

import { hasTransportToShow, TransportBar } from '../../../src/components/playout/transport.bar';
import { playoutItem, playoutStatus } from '../../utils/playout.fixture';
import { render, screen } from '../../utils/render';

const skip = vi.fn();
const stop = vi.fn();

const setAirMode = vi.fn();

vi.mock('../../../src/api/playout.queries', () => ({
    useSkipCurrent: () => ({ mutate: skip, isPending: false }),
    useStopPlayout: () => ({ mutate: stop, isPending: false }),
}));

vi.mock('../../../src/api/director.queries', () => ({
    useSetAirMode: () => ({ mutate: setAirMode, isPending: false }),
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

    it('speaks up for a container running replaced config, even on an idle station', () => {
        // The next attempt to go on air will fail, and the strip is the only place that
        // says why. An idle station is exactly when an operator is about to try.
        const idle = { nowPlaying: undefined, upNext: [], queuedCount: 0, staleStreamConfig: [staleWarning()] };

        expect(hasTransportToShow(playoutStatus(idle))).toBe(true);
    });
});

/** One container behind, as the status reports it. */
const staleWarning = (overrides: Partial<StreamConfigWarning> = {}): StreamConfigWarning => ({
    container: 'icecast',
    detail: 'icecast started at 2026-08-11T12:17:00.000Z and its config last changed at 2026-08-11T12:33:00.000Z.',
    restart: 'docker compose restart icecast',
    ...overrides,
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
        expect(screen.getByLabelText('Take the station out of service')).toBeInTheDocument();

        rerender(<TransportBar status={playoutStatus()} expanded onToggleExpanded={vi.fn()} />);

        expect(screen.queryByLabelText('Take the station out of service')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Take out of service' }));
        expect(stop).toHaveBeenCalledOnce();
    });

    it('flags a container running replaced config, and gives the command in full once expanded', () => {
        // The fault with no other symptom: the stream is up, the order is full, the
        // station says it is on air, and every listener is being refused at the door.
        // Nothing else on this bar would be anything but green.
        const status = playoutStatus({
            staleStreamConfig: [staleWarning({ container: 'liquidsoap', restart: 'docker compose restart liquidsoap' })],
        });
        const { rerender } = renderBar(status);

        expect(screen.getByText('config not adopted')).toBeInTheDocument();
        // Collapsed, the command is not on screen: the strip has no room for it, and the
        // badge says where to look.
        expect(screen.queryByText('docker compose restart liquidsoap')).not.toBeInTheDocument();

        rerender(<TransportBar status={status} expanded onToggleExpanded={vi.fn()} />);

        expect(screen.getByText('A stream container is running config that has been replaced')).toBeInTheDocument();
        expect(screen.getByText('docker compose restart liquidsoap')).toBeInTheDocument();
    });

    it('says nothing about config while both containers are current', () => {
        renderBar(playoutStatus(), true);

        expect(screen.queryByText('config not adopted')).not.toBeInTheDocument();
        expect(screen.queryByText(/^docker compose restart/)).not.toBeInTheDocument();
    });

    it('says how many people are listening', () => {
        renderBar(playoutStatus({ listeners: 3 }));

        expect(screen.getByText('♫ 3 listening')).toBeInTheDocument();
    });

    it('says nobody is listening rather than showing a bare zero', () => {
        renderBar(playoutStatus({ listeners: 0, audience: false, onAir: false }));

        expect(screen.getByText('♫ nobody listening')).toBeInTheDocument();
    });

    it('explains a silent station that is merely waiting for a listener', async () => {
        // The resting state of an audience-gated station. "Starting…" here reads as
        // something stuck, and sends an operator looking for a fault that is not there.
        renderBar(playoutStatus({ nowPlaying: undefined, onAir: false, audience: false, listeners: 0 }));

        expect(screen.getByText('Ready: waiting for a listener.')).toBeInTheDocument();
    });

    it('still says the stream is unreachable ahead of anything about listeners', () => {
        // An audience cannot be the explanation when nothing could air for anyone.
        renderBar(playoutStatus({ nowPlaying: undefined, streamUp: false, onAir: false, audience: false, listeners: 0 }));

        expect(screen.getByText('The stream is not reachable, so nothing can go to air.')).toBeInTheDocument();
    });

    it('changes what puts the station on air', async () => {
        render(<TransportBar status={playoutStatus()} airMode="audience" expanded onToggleExpanded={vi.fn()} />);

        await userEvent.click(screen.getByRole('radio', { name: 'Always on' }));

        expect(setAirMode).toHaveBeenCalledWith({ airMode: 'always' });
    });

    it('offers no air mode control until the reading says which one it is', () => {
        // Drawing `audience` before the answer arrives would show an operator a setting
        // nobody chose, and a control that appears to move on its own a moment later.
        render(<TransportBar status={playoutStatus()} expanded onToggleExpanded={vi.fn()} />);

        expect(screen.queryByRole('radio', { name: 'Always on' })).not.toBeInTheDocument();
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
