// Four verbs that all send the station off to do work again, so what is pinned here is the part an
// operator relies on: nothing happens without a confirmation, the answer stays on screen afterwards,
// and a refusal is shown rather than swallowed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { TrackClearMenu } from '../../../src/components/catalog/track.clear.menu';
import { render, screen, waitFor } from '../../utils/render';

const clearTrackAudio = vi.fn();
const clearTrackAnalysis = vi.fn();
const clearTrackEnrichment = vi.fn();
const retryTrackAudio = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            clearTrackAudio: (...args: unknown[]) => clearTrackAudio(...args),
            clearTrackAnalysis: (...args: unknown[]) => clearTrackAnalysis(...args),
            clearTrackEnrichment: (...args: unknown[]) => clearTrackEnrichment(...args),
            retryTrackAudio: (...args: unknown[]) => retryTrackAudio(...args),
        },
    },
}));

const TRACK_ID = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
    vi.resetAllMocks();
});

const open = async (label: string | RegExp) => {
    await userEvent.click(screen.getByRole('button', { name: 'Clear…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: label }));
};

describe('TrackClearMenu', () => {
    it('asks before it does anything, and says what will happen', async () => {
        render(<TrackClearMenu trackId={TRACK_ID} />);

        await open('Throw away the local copies');

        expect(await screen.findByText('Throw away the local copies?')).toBeInTheDocument();
        expect(screen.getByText(/fetches the record again/)).toBeInTheDocument();
        expect(clearTrackAudio).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is declined', async () => {
        render(<TrackClearMenu trackId={TRACK_ID} />);

        await open('Throw away the local copies');
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(clearTrackAudio).not.toHaveBeenCalled();
    });

    // The answer is the interesting half: "Dropped 2 copies" and "was not holding any copies" are
    // different facts about the record, and a menu that closed silently would throw away the second.
    it('clears on confirmation and keeps the answer on screen', async () => {
        clearTrackAudio.mockResolvedValue({ trackId: TRACK_ID, cleared: 2, detail: 'Dropped 2 copies. The station fetches it again when it next comes round.' });
        render(<TrackClearMenu trackId={TRACK_ID} />);

        await open('Throw away the local copies');
        await userEvent.click(screen.getByRole('button', { name: 'Throw them away' }));

        await waitFor(() => expect(clearTrackAudio).toHaveBeenCalledWith(TRACK_ID));
        expect(await screen.findByText(/Dropped 2 copies/)).toBeInTheDocument();
    });

    // A record about to air is left alone deliberately, and the message says what to do instead —
    // which is the one refusal worth reading in full rather than reducing to "failed".
    it('shows the refusal when the record is about to air', async () => {
        clearTrackAudio.mockRejectedValue(
            new SdkError(
                409,
                'Conflict',
                { statusCode: 409, message: 'this record is about to air or is being fetched right now, so its audio was left alone' },
                new Headers(),
            ),
        );
        render(<TrackClearMenu trackId={TRACK_ID} />);

        await open('Throw away the local copies');
        await userEvent.click(screen.getByRole('button', { name: 'Throw them away' }));

        expect(await screen.findByText('Left alone')).toBeInTheDocument();
        expect(screen.getByText(/about to air/)).toBeInTheDocument();
    });

    it('says the station’s own facts survive an enrichment clear, before it is pressed', async () => {
        render(<TrackClearMenu trackId={TRACK_ID} />);

        await open('Forget what the providers said');

        expect(await screen.findByText(/facts, the ones with a source and a quote, are not touched/)).toBeInTheDocument();
    });

    it.each([
        ['Forget the measurement', 'Forget it', () => clearTrackAnalysis],
        ['Forget what the providers said', 'Forget them', () => clearTrackEnrichment],
        ['Try the copies again now', 'Try again', () => retryTrackAudio],
    ])('sends %s', async (item, confirm, call) => {
        call().mockResolvedValue({ trackId: TRACK_ID, cleared: 1, detail: 'Done.' });
        render(<TrackClearMenu trackId={TRACK_ID} />);

        await open(item);
        await userEvent.click(screen.getByRole('button', { name: confirm }));

        await waitFor(() => expect(call()).toHaveBeenCalledWith(TRACK_ID));
    });
});
