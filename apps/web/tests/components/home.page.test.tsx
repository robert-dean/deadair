import { afterEach, describe, expect, it, vi } from 'vitest';

import { HomePage } from '../../src/components/home.page';
import { playoutStatus } from '../utils/playout.fixture';
import { render, screen, waitFor } from '../utils/render';

const getPlayoutStatus = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: { playout: { getPlayoutStatus: () => getPlayoutStatus() } },
}));

afterEach(() => {
    getPlayoutStatus.mockReset();
});

describe('HomePage', () => {
    it('renders the station name as the page heading', () => {
        getPlayoutStatus.mockResolvedValue(playoutStatus());
        render(<HomePage />);

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('deadair');
    });

    it('says nothing about the station until it has heard from it', () => {
        // A tally light that guesses is worse than one that waits: "off air" before
        // the first reading is a claim, not an absence of one.
        getPlayoutStatus.mockReturnValue(new Promise(() => {}));
        render(<HomePage />);

        expect(screen.queryByText('on air')).not.toBeInTheDocument();
        expect(screen.queryByText('off air')).not.toBeInTheDocument();
    });

    it('lights up while the station is broadcasting', async () => {
        getPlayoutStatus.mockResolvedValue(playoutStatus());
        render(<HomePage />);

        expect(await screen.findByText('on air')).toBeInTheDocument();
    });

    it('stays off air when the stream is reachable but nothing is driving it', async () => {
        // The state the lease creates, and the one worth being unambiguous about: a
        // healthy Liquidsoap with no programme is connected and airing silence.
        getPlayoutStatus.mockResolvedValue(playoutStatus({ streamUp: true, onAir: false }));
        render(<HomePage />);

        expect(await screen.findByText('off air')).toBeInTheDocument();
    });

    it('distinguishes an unreachable stream from an idle one', async () => {
        getPlayoutStatus.mockResolvedValue(playoutStatus({ streamUp: false, onAir: false }));
        render(<HomePage />);

        await waitFor(() => {
            expect(screen.getByText('stream unreachable')).toBeInTheDocument();
        });
    });
});
