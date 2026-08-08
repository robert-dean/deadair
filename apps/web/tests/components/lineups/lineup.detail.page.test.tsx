// The cursor is the point of this page: everything above it is in the player's hands and beyond
// editing, everything below it is still the operator's. What is tested here is that the page says
// so, that its edits carry the revision the operator was looking at, and that the two different
// 409s the API can answer with are told apart.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { LineupDetailPage } from '../../../src/components/lineups/lineup.detail.page';
import { lineup, lineupItem, stationAir } from '../../utils/lineup.fixture';
import { render, screen, waitFor, within } from '../../utils/render';

const getALineup = vi.fn();
const getStationAir = vi.fn();
const removeALineupItem = vi.fn();
const shuffleALineup = vi.fn();
const putALineupOnAir = vi.fn();
const extendALineup = vi.fn();
const deleteALineup = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        director: {
            getALineup: (...args: unknown[]) => getALineup(...args),
            getStationAir: () => getStationAir(),
            removeALineupItem: (...args: unknown[]) => removeALineupItem(...args),
            shuffleALineup: (...args: unknown[]) => shuffleALineup(...args),
            putALineupOnAir: (...args: unknown[]) => putALineupOnAir(...args),
            extendALineup: (...args: unknown[]) => extendALineup(...args),
            deleteALineup: (...args: unknown[]) => deleteALineup(...args),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
    useNavigate: () => vi.fn(),
}));

/** A lineup on air, with its first line already committed to the player. */
function lineupOnAir() {
    return lineup({
        cursor: 1,
        items: [
            lineupItem({ id: 'line-1', title: 'Windowlicker', committed: true }),
            lineupItem({ id: 'line-2', title: 'Come to Daddy' }),
            lineupItem({ id: 'line-3', title: 'Xtal' }),
        ],
    });
}

/** A 409 as the API sends it. `message` is what the console is expected to show for a delete. */
function conflict(message: string) {
    return new SdkError(409, 'Conflict', { statusCode: 409, message }, new Headers());
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('LineupDetailPage', () => {
    it('draws the order and says how far the broadcast has got into it', async () => {
        getALineup.mockResolvedValue(lineupOnAir());
        getStationAir.mockResolvedValue(stationAir());

        render(<LineupDetailPage lineupId="lineup-1" />);

        expect(await screen.findByText('Late shift')).toBeInTheDocument();
        expect(screen.getByText('on air')).toBeInTheDocument();
        expect(screen.getByText(/3 tracks • 1 locked • 2 to go/)).toBeInTheDocument();
        // The committed line stays on the page: it is how an operator reads where the station is.
        expect(screen.getByText('Windowlicker')).toBeInTheDocument();
        expect(screen.getByText('locked')).toBeInTheDocument();
    });

    it('counts both halves off the lineup, so they add up when the air poll has moved on', async () => {
        // The two readings are taken on different clocks: the air poll runs every five seconds and
        // the lineup is only re-read when something changes it. Taking "locked" from one and "to go"
        // from the other puts a sentence on the page whose numbers do not sum to the track count
        // printed beside them, which is exactly what happened on the real station.
        getALineup.mockResolvedValue(lineupOnAir());
        getStationAir.mockResolvedValue(stationAir({ cursor: 2, remaining: 1 }));

        render(<LineupDetailPage lineupId="lineup-1" />);

        expect(await screen.findByText(/3 tracks • 1 locked • 2 to go/)).toBeInTheDocument();
    });

    it('offers no way to drop a line the player is already holding', async () => {
        getALineup.mockResolvedValue(lineupOnAir());
        getStationAir.mockResolvedValue(stationAir());

        render(<LineupDetailPage lineupId="lineup-1" />);
        await screen.findByText('Late shift');

        expect(screen.queryByRole('button', { name: 'Drop Windowlicker' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Drop Come to Daddy' })).toBeInTheDocument();
    });

    it('sends the revision the operator was looking at with a removal', async () => {
        getALineup.mockResolvedValue(lineupOnAir());
        getStationAir.mockResolvedValue(stationAir());
        removeALineupItem.mockResolvedValue(lineup({ revision: 5 }));

        render(<LineupDetailPage lineupId="lineup-1" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Drop Come to Daddy' }));

        await waitFor(() => expect(removeALineupItem).toHaveBeenCalledWith('lineup-1', 'line-2', { revision: 4 }));
    });

    it('says what a refused edit means, and re-reads the order', async () => {
        getALineup.mockResolvedValue(lineupOnAir());
        getStationAir.mockResolvedValue(stationAir());
        removeALineupItem.mockRejectedValue(conflict('the lineup has changed since that revision'));

        render(<LineupDetailPage lineupId="lineup-1" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Drop Come to Daddy' }));

        expect(await screen.findByText('That edit was refused')).toBeInTheDocument();
        // The refetch is the point: the operator can make the same decision against what is true.
        await waitFor(() => expect(getALineup).toHaveBeenCalledTimes(2));
    });

    it('shows a delete refusal in the API’s own words rather than as a stale revision', async () => {
        // A 409 from delete means the lineup is on air, which re-reading the order would not fix.
        getALineup.mockResolvedValue(lineupOnAir());
        getStationAir.mockResolvedValue(stationAir());
        deleteALineup.mockRejectedValue(conflict('that lineup is on air; stop the station or put another one on first'));

        render(<LineupDetailPage lineupId="lineup-1" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
        // Deleting is confirmed, not immediate: the order goes with the lineup.
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(deleteALineup).toHaveBeenCalledWith('lineup-1'));
        expect(await screen.findByRole('button', { name: 'Failed' })).toBeInTheDocument();
        expect(screen.queryByText('That edit was refused')).not.toBeInTheDocument();
    });

    it('will not offer to air a lineup that holds nothing', async () => {
        getALineup.mockResolvedValue(lineup({ items: [], cursor: 0 }));
        getStationAir.mockResolvedValue({ active: false, cursor: 0, remaining: 0 });

        render(<LineupDetailPage lineupId="lineup-1" />);

        expect(await screen.findByText(/Putting it on air would air silence/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Put on air' })).toBeDisabled();
    });

    it('puts a lineup on air from the top, without claiming to be interrupting anything', async () => {
        getALineup.mockResolvedValue(lineup());
        getStationAir.mockResolvedValue({ active: false, cursor: 0, remaining: 0 });
        putALineupOnAir.mockResolvedValue(stationAir());

        render(<LineupDetailPage lineupId="lineup-1" />);
        await userEvent.click(await screen.findByRole('button', { name: 'Put on air' }));

        // `interrupting` is for a feature that means to hand the station back, not for an operator
        // changing the programming.
        await waitFor(() => expect(putALineupOnAir).toHaveBeenCalledWith({ lineupId: 'lineup-1' }));
    });
});
