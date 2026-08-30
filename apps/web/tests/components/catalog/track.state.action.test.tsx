// One press carrying out a decision an operator made once, over a run of records a provider spoiled
// at the same moment. What is pinned is the part they rely on: it appears only where there is
// actually something to do, it asks first, it acts on exactly the rows they are looking at, and one
// record the station will not act on does not stop the rest.

import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { TrackStateAction } from '../../../src/components/catalog/track.state.action';
import { render, screen, waitFor } from '../../utils/render';

const retryTrackAudio = vi.fn();
const offerTrackCopiesAgain = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            retryTrackAudio: (...args: unknown[]) => retryTrackAudio(...args),
            offerTrackCopiesAgain: (...args: unknown[]) => offerTrackCopiesAgain(...args),
        },
    },
}));

const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

afterEach(() => {
    vi.resetAllMocks();
});

describe('TrackStateAction', () => {
    it('offers nothing for a list that is not in a fault state', () => {
        // Most of a library is `uncached`, and a bulk verb over that is a re-fetch of everything.
        render(<TrackStateAction state="uncached" trackIds={IDS} />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers nothing when the filter has narrowed to no records at all', () => {
        render(<TrackStateAction state="benched" trackIds={[]} />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    // A press that WORKS empties the list it was pressed on, so the answer has to outlive the rows
    // it was about: otherwise it vanishes at exactly the moment there is one, and the operator is
    // left on an empty page with no idea whether anything happened.
    it('keeps the tally after the rows it acted on have left the list', async () => {
        offerTrackCopiesAgain.mockResolvedValue({ trackId: IDS[0], cleared: 1, detail: 'Done.' });
        const { rerender } = render(<TrackStateAction state="benched" trackIds={IDS} />);

        await userEvent.click(screen.getByRole('button', { name: 'Offer these again (2)' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Offer them again' }));
        await screen.findByText('2 records reopened.');

        rerender(<TrackStateAction state="benched" trackIds={[]} />);

        expect(screen.getByText('2 records reopened.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Offer these again/ })).not.toBeInTheDocument();
    });

    it('asks before it does anything, and says what a re-offer overrides', async () => {
        render(<TrackStateAction state="benched" trackIds={IDS} />);

        await userEvent.click(screen.getByRole('button', { name: 'Offer these again (2)' }));

        expect(await screen.findByText(/said it holds no audio and never will/)).toBeInTheDocument();
        expect(screen.getByText('This acts on the 2 records on this page.')).toBeInTheDocument();
        expect(offerTrackCopiesAgain).not.toHaveBeenCalled();
    });

    it('sends the re-offer for every record the list is showing, and reports the tally', async () => {
        offerTrackCopiesAgain.mockResolvedValue({ trackId: IDS[0], cleared: 1, detail: 'Done.' });
        render(<TrackStateAction state="benched" trackIds={IDS} />);

        await userEvent.click(screen.getByRole('button', { name: 'Offer these again (2)' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Offer them again' }));

        await waitFor(() => expect(offerTrackCopiesAgain).toHaveBeenCalledTimes(2));
        expect(offerTrackCopiesAgain).toHaveBeenCalledWith(IDS[0]);
        expect(offerTrackCopiesAgain).toHaveBeenCalledWith(IDS[1]);
        expect(await screen.findByText('2 records reopened.')).toBeInTheDocument();
    });

    it('sends the retry for a failing list, which is a different verb', async () => {
        retryTrackAudio.mockResolvedValue({ trackId: IDS[0], cleared: 1, detail: 'Done.' });
        render(<TrackStateAction state="failing" trackIds={IDS} />);

        await userEvent.click(screen.getByRole('button', { name: 'Try these again (2)' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

        await waitFor(() => expect(retryTrackAudio).toHaveBeenCalledTimes(2));
        expect(offerTrackCopiesAgain).not.toHaveBeenCalled();
    });

    // One record the station refuses must not cost the other ninety-nine, and the tally is what the
    // operator needs afterwards rather than a thrown error.
    it('keeps going past a record the station will not act on, and counts it', async () => {
        offerTrackCopiesAgain.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({ trackId: IDS[1], cleared: 1, detail: 'Done.' });
        render(<TrackStateAction state="benched" trackIds={IDS} />);

        await userEvent.click(screen.getByRole('button', { name: 'Offer these again (2)' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Offer them again' }));

        expect(await screen.findByText('1 record reopened, 1 the station would not act on.')).toBeInTheDocument();
    });
});
