import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { VocalMarkersCard } from '../../../src/components/catalog/vocal.markers.card';
import { render, screen, waitFor } from '../../utils/render';

const getVocalMarkers = vi.fn();
const setVocalMarkers = vi.fn();
const clearVocalMarkers = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            getVocalMarkers: (...args: unknown[]) => getVocalMarkers(...args),
            setVocalMarkers: (...args: unknown[]) => setVocalMarkers(...args),
            clearVocalMarkers: (...args: unknown[]) => clearVocalMarkers(...args),
        },
    },
}));

const TRACK_ID = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
    vi.clearAllMocks();
});

describe('VocalMarkersCard', () => {
    it('shows where the singing starts and stops, and that the lyrics said so', async () => {
        getVocalMarkers.mockResolvedValue({ trackId: TRACK_ID, kind: 'ranges', onsetMs: 29_790, endMs: 230_000, source: 'lyrics' });

        render(<VocalMarkersCard trackId={TRACK_ID} />);

        expect(await screen.findByText('29.8 s')).toBeInTheDocument();
        expect(screen.getByText('230.0 s')).toBeInTheDocument();
        expect(screen.getByText('Its timed lyrics')).toBeInTheDocument();
    });

    it('says so when there is nothing to go on', async () => {
        getVocalMarkers.mockResolvedValue({ trackId: TRACK_ID, kind: 'unknown', source: 'none' });

        render(<VocalMarkersCard trackId={TRACK_ID} />);

        expect(await screen.findByText(/Nothing to go on/)).toBeInTheDocument();
    });

    it('sends a correction in milliseconds', async () => {
        getVocalMarkers.mockResolvedValue({ trackId: TRACK_ID, kind: 'unknown', source: 'none' });
        setVocalMarkers.mockResolvedValue({ trackId: TRACK_ID, kind: 'ranges', onsetMs: 12_500, endMs: 12_500, source: 'override' });

        render(<VocalMarkersCard trackId={TRACK_ID} />);
        await userEvent.click(await screen.findByRole('button', { name: 'Correct' }));
        await userEvent.type(screen.getByLabelText('Singing starts'), '12.5');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(setVocalMarkers).toHaveBeenCalledWith(TRACK_ID, { onsetMs: 12_500 }));
        expect(await screen.findByText('Your correction')).toBeInTheDocument();
    });

    it('offers the lyrics back once there is a correction', async () => {
        getVocalMarkers.mockResolvedValue({ trackId: TRACK_ID, kind: 'instrumental', source: 'override' });
        clearVocalMarkers.mockResolvedValue({ trackId: TRACK_ID, kind: 'unknown', source: 'none' });

        render(<VocalMarkersCard trackId={TRACK_ID} />);
        expect(await screen.findByText('Nobody sings')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Use its lyrics again' }));

        await waitFor(() => expect(clearVocalMarkers).toHaveBeenCalledWith(TRACK_ID));
    });
});
