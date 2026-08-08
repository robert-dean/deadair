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
        getStationAir.mockResolvedValue({ active: false, cursor: 0, remaining: 0 });

        render(<LineupsPage />);

        expect(await screen.findByText('Late shift')).toBeInTheDocument();
        expect(screen.getByText('Breakfast')).toBeInTheDocument();
        expect(screen.getByText('2 lineups')).toBeInTheDocument();
        // Singular, because "1 tracks" on a one-track lineup is the sort of thing an operator reads
        // as a bug in the station.
        expect(screen.getByText(/^1 track$/)).toBeInTheDocument();
    });

    it('marks the lineup that is on air, and only that one', async () => {
        listLineups.mockResolvedValue({ lineups: [lineupSummary(), lineupSummary({ id: 'lineup-2', name: 'Breakfast' })] });
        getStationAir.mockResolvedValue(stationAir());

        render(<LineupsPage />);

        expect(await screen.findByText('on air')).toBeInTheDocument();
        expect(screen.getAllByText('on air')).toHaveLength(1);
    });

    it('says a station was stood down rather than dropping the badge entirely', async () => {
        // The API keeps sending the lineup id after a stand-down precisely so the console can still
        // say what the station was playing. Showing nothing would throw that away.
        listLineups.mockResolvedValue({ lineups: [lineupSummary()] });
        getStationAir.mockResolvedValue(stationAir({ active: false }));

        render(<LineupsPage />);

        expect(await screen.findByText('stood down')).toBeInTheDocument();
        expect(screen.queryByText('on air')).not.toBeInTheDocument();
    });

    it('points an empty station at the playlists it could import from', async () => {
        listLineups.mockResolvedValue({ lineups: [] });
        getStationAir.mockResolvedValue({ active: false, cursor: 0, remaining: 0 });

        render(<LineupsPage />);

        expect(await screen.findByText('The station has no lineups')).toBeInTheDocument();
        expect(screen.getByText('Browse playlists')).toBeInTheDocument();
    });

    it('shows the API’s own message when the programming cannot be read', async () => {
        listLineups.mockRejectedValue(
            new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'the database is not answering' }, new Headers()),
        );
        getStationAir.mockResolvedValue({ active: false, cursor: 0, remaining: 0 });

        render(<LineupsPage />);

        expect(await screen.findByText('Lineups could not be loaded')).toBeInTheDocument();
        expect(screen.getByText('the database is not answering')).toBeInTheDocument();
    });
});
