// Listeners. Pinned: every connection is drawn with its stream, address, player and time, an HLS
// player is labelled as one, a mount that could not be read is named rather than looking empty, the
// station's count is explained when the list disagrees with it, and a listener account is told why
// it cannot see the page rather than shown an error.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError, type StreamListeners } from '@deadair/sdk';

import { ListenersPage } from '../../../src/components/station/listeners.page';
import { render, screen } from '../../utils/render';

const listStreamListeners = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: { stream: { listStreamListeners: () => listStreamListeners() } },
}));

const answer = (over: Partial<StreamListeners> = {}): StreamListeners => ({
    readAt: DateTime.fromISO('2026-10-28T12:00:00Z'),
    total: 2,
    connections: [
        { via: 'icecast', mount: '/live.mp3', address: '203.0.113.7', agent: 'VLC/3.0.21 LibVLC/3.0.21', connectedMs: 3_725_000 },
        { via: 'hls', address: '2001:db8::5', connectedMs: 42_000 },
    ],
    unreadable: [],
    ...over,
});

afterEach(() => {
    listStreamListeners.mockReset();
});

describe('ListenersPage', () => {
    it('draws each connection with its stream, address, player and how long it has been on', async () => {
        listStreamListeners.mockResolvedValue(answer());

        render(<ListenersPage />);

        expect(await screen.findByText('203.0.113.7')).toBeInTheDocument();
        expect(screen.getByText('/live.mp3')).toBeInTheDocument();
        expect(screen.getByText('VLC/3.0.21 LibVLC/3.0.21')).toBeInTheDocument();
        expect(screen.getByText('1:02:05')).toBeInTheDocument();

        expect(screen.getByText('2001:db8::5')).toBeInTheDocument();
        expect(screen.getByText('HLS')).toBeInTheDocument();
        expect(screen.getByText('Did not say')).toBeInTheDocument();
        expect(screen.getByText('0:42')).toBeInTheDocument();

        expect(screen.getByText('2 listening')).toBeInTheDocument();
        // The list and the count agree, so there is nothing to explain.
        expect(screen.queryByText(/The station counts/)).not.toBeInTheDocument();
    });

    it('names a stream it could not read, rather than letting it look empty', async () => {
        listStreamListeners.mockResolvedValue(
            answer({
                total: 1,
                connections: [{ via: 'icecast', mount: '/live.mp3', address: '203.0.113.7', connectedMs: 1_000 }],
                unreadable: [{ mount: '/live.flac', reason: 'unanswered' }],
            }),
        );

        render(<ListenersPage />);

        expect(await screen.findByText('One stream could not be read, so its listeners are missing below')).toBeInTheDocument();
        expect(screen.getByText('/live.flac: Icecast did not answer in time.')).toBeInTheDocument();
    });

    it('explains the station count when the list disagrees with it', async () => {
        listStreamListeners.mockResolvedValue(answer({ total: 3 }));

        render(<ListenersPage />);

        expect(await screen.findByText(/^The station counts 3 listeners and lists 2\./)).toBeInTheDocument();
    });

    it('says nobody is listening when nobody is, and nothing is missing', async () => {
        listStreamListeners.mockResolvedValue(answer({ total: 0, connections: [] }));

        render(<ListenersPage />);

        expect(await screen.findByText('Nobody is listening right now.')).toBeInTheDocument();
        expect(screen.getByText('0 listening')).toBeInTheDocument();
    });

    it('does not say nobody is listening when every stream was unreadable', async () => {
        listStreamListeners.mockResolvedValue(answer({ total: 0, connections: [], unreadable: [{ mount: '/live.mp3', reason: 'refused' }] }));

        render(<ListenersPage />);

        expect(await screen.findByText(/Icecast refused the station’s admin password/)).toBeInTheDocument();
        expect(screen.queryByText('Nobody is listening right now.')).not.toBeInTheDocument();
    });

    it('tells an account that is not an admin why it cannot see the list', async () => {
        listStreamListeners.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));

        render(<ListenersPage />);

        expect(await screen.findByText(/^Only an admin can see who is listening\./)).toBeInTheDocument();
    });
});
