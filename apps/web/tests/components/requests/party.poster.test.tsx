// The poster for a TV: the code, big, and the browser's own full screen.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { PartyPoster } from '../../../src/components/requests/party.poster';
import { render, screen, setupUser } from '../../utils/render';

const getParty = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        requests: { party: { getParty: () => getParty() } },
        nowplaying: {
            getNowPlaying: async () => ({
                station: 'Deadair',
                onAir: true,
                listeners: 0,
                mounts: [],
                track: { kind: 'record', title: 'Holy Diver', artist: 'Dio' },
            }),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({ Link: (props: object) => <a {...props} /> }));

afterEach(() => {
    vi.resetAllMocks();
});

describe('PartyPoster', () => {
    it('shows the code, the station and what is playing', async () => {
        getParty.mockResolvedValue({
            party: { token: 'dp_abc', createdAt: DateTime.utc(), expiresAt: DateTime.utc().plus({ hours: 2 }), guests: 0 },
        });
        render(<PartyPoster />);

        expect(await screen.findByText('Scan to ask for a record')).toBeInTheDocument();
        expect(screen.getByTitle('The party’s code')).toBeInTheDocument();
        expect(await screen.findByText('Holy Diver by Dio')).toBeInTheDocument();
        expect(screen.getByText('Deadair')).toBeInTheDocument();
    });

    it('asks the browser for full screen on the poster itself', async () => {
        getParty.mockResolvedValue({
            party: { token: 'dp_abc', createdAt: DateTime.utc(), expiresAt: DateTime.utc().plus({ hours: 2 }), guests: 0 },
        });
        const requestFullscreen = vi.fn(async () => undefined);
        HTMLElement.prototype.requestFullscreen = requestFullscreen;
        const user = setupUser();
        render(<PartyPoster />);

        await user.click(await screen.findByRole('button', { name: 'Full screen' }));

        expect(requestFullscreen).toHaveBeenCalledOnce();
    });

    it('says so when no party is on, and offers no full screen', async () => {
        getParty.mockResolvedValue({});
        render(<PartyPoster />);

        expect(await screen.findByText('No party is on.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument();
    });
});
