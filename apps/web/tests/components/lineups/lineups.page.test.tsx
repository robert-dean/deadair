import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { LineupsPage } from '../../../src/components/lineups/lineups.page';
import { lineupSummary, stationAir } from '../../utils/lineup.fixture';
import { render, screen } from '../../utils/render';

const listLineups = vi.fn();
const getStationAir = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            listLineups: () => listLineups(),
            getStationAir: () => getStationAir(),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
    // The import modal lands on the lineup it just made.
    useNavigate: () => vi.fn(),
}));

afterEach(() => {
    listLineups.mockReset();
    getStationAir.mockReset();
});

describe('LineupsPage', () => {
    it('renders a card per lineup and counts them', async () => {
        listLineups.mockResolvedValue({
            lineups: [lineupSummary(), lineupSummary({ id: 'lineup-2', name: 'Breakfast', itemCount: 1, sourcePluginId: undefined })],
        });
        getStationAir.mockResolvedValue({ active: false, airMode: 'audience', remaining: 0 });

        render(<LineupsPage />);

        expect(await screen.findByText('Late shift')).toBeInTheDocument();
        expect(screen.getByText('Breakfast')).toBeInTheDocument();
        expect(screen.getByText('2 lineups')).toBeInTheDocument();
        // Singular, because "1 tracks" on a one-track lineup is the sort of thing an operator reads
        // as a bug in the station.
        expect(screen.getByText(/^1 track$/)).toBeInTheDocument();
    });

    it('marks nothing as on air, because nothing airs from a stored lineup', async () => {
        // What is on air is built from a playlist when the station goes on, so the station has no
        // opinion about a stored lineup at all. A badge here would be inventing one.
        listLineups.mockResolvedValue({ lineups: [lineupSummary(), lineupSummary({ id: 'lineup-2', name: 'Breakfast' })] });
        getStationAir.mockResolvedValue(stationAir());

        render(<LineupsPage />);

        expect(await screen.findByText('Late shift')).toBeInTheDocument();
        expect(screen.queryByText('on air')).not.toBeInTheDocument();
        expect(screen.queryByText('stood down')).not.toBeInTheDocument();
    });

    it('points an empty station at the playlists it could import from', async () => {
        listLineups.mockResolvedValue({ lineups: [] });
        getStationAir.mockResolvedValue({ active: false, airMode: 'audience', remaining: 0 });

        render(<LineupsPage />);

        expect(await screen.findByText('The station has no lineups')).toBeInTheDocument();
        expect(screen.getByText('Browse playlists')).toBeInTheDocument();
    });

    it('shows the API’s own message when the programming cannot be read', async () => {
        listLineups.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'the database is not answering' }, new Headers()),
        );
        getStationAir.mockResolvedValue({ active: false, airMode: 'audience', remaining: 0 });

        render(<LineupsPage />);

        expect(await screen.findByText('Lineups could not be loaded')).toBeInTheDocument();
        expect(screen.getByText('the database is not answering')).toBeInTheDocument();
    });
});
