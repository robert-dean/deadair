// The segment library. What is worth pinning is what the page refuses to imply: a segment that is
// not ready cannot be played, a failed one says why rather than offering a retry that has no route
// behind it, and planning one closes the form rather than waiting on a render that is a job.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@deadair/sdk';

import { SegmentsPage } from '../../../src/components/segments/segments.page';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listSegments = vi.fn();
const createSegment = vi.fn();
const scanTheSegmentInbox = vi.fn();
const listVoices = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        render: {
            listSegments: (...args: unknown[]) => listSegments(...args),
            createSegment: (...args: unknown[]) => createSegment(...args),
            scanTheSegmentInbox: (...args: unknown[]) => scanTheSegmentInbox(...args),
            listVoices: (...args: unknown[]) => listVoices(...args),
        },
    },
}));

const segment = (over: Partial<Segment> = {}): Segment => ({
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'ident',
    state: 'ready',
    label: 'Top of hour',
    source: 'library',
    playable: true,
    ...over,
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('SegmentsPage', () => {
    it('groups the library by what each segment is for', async () => {
        listSegments.mockResolvedValue({ segments: [segment(), segment({ id: 'b', kind: 'talkbreak', label: 'A link' })] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        expect(await screen.findByText('ident')).toBeInTheDocument();
        expect(screen.getByText('talkbreak')).toBeInTheDocument();
        expect(screen.getByText('Top of hour')).toBeInTheDocument();
    });

    /**
     * `playable` is the row's own answer to whether there is audio. A play button on a segment still
     * being rendered is a button that 404s, which reads as a broken page rather than as one waiting.
     */
    it('offers no way to play a segment that has no audio yet', async () => {
        listSegments.mockResolvedValue({ segments: [segment({ state: 'rendering', playable: false, label: 'Still cooking' })] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);
        await screen.findByText('Still cooking');

        expect(screen.queryByRole('button', { name: 'Play Still cooking' })).not.toBeInTheDocument();
    });

    it('offers one for a segment that does', async () => {
        listSegments.mockResolvedValue({ segments: [segment()] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        expect(await screen.findByRole('button', { name: 'Play Top of hour' })).toBeInTheDocument();
    });

    /**
     * There is no route that re-renders a failed segment, so the page does not pretend there is.
     * What it can do instead is say what went wrong, which is what makes the row actionable at all.
     */
    it('says why a segment failed rather than offering a retry it cannot do', async () => {
        listSegments.mockResolvedValue({
            segments: [segment({ state: 'failed', playable: false, label: 'Bad one', error: 'the speech engine refused' })],
        });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        expect(await screen.findByText('the speech engine refused')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /retry|re-render/i })).not.toBeInTheDocument();
    });

    it('plans a segment and stops waiting on it, because speaking it is a job', async () => {
        listSegments.mockResolvedValue({ segments: [] });
        listVoices.mockResolvedValue({ voices: [] });
        createSegment.mockResolvedValue(segment({ state: 'planned', playable: false }));

        render(<SegmentsPage />);

        const user = setupUser();
        await user.click(await screen.findByRole('button', { name: 'Write one' }));
        await user.type(screen.getByLabelText('Label'), 'Station ident');
        await user.type(screen.getByLabelText('Script'), 'You are listening to deadair.');
        await user.click(screen.getByRole('button', { name: 'Plan it' }));

        await waitFor(() => {
            expect(createSegment).toHaveBeenCalledWith(expect.objectContaining({ label: 'Station ident', kind: 'talkbreak' }));
        });
        // The form closes rather than waiting: the POST answers `planned` every time and the list's
        // own poll carries the row the rest of the way.
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Plan it' })).not.toBeInTheDocument();
        });
    });

    it('will not plan one with nothing to say', async () => {
        listSegments.mockResolvedValue({ segments: [] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        await setupUser().click(await screen.findByRole('button', { name: 'Write one' }));

        expect(screen.getByRole('button', { name: 'Plan it' })).toBeDisabled();
    });

    it('says what an empty library means rather than showing a bare table', async () => {
        listSegments.mockResolvedValue({ segments: [] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        expect(await screen.findByText('The station has no segments')).toBeInTheDocument();
    });
});
