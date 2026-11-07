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
const deleteSegment = vi.fn();
const scopeSegment = vi.fn();
const listSchedule = vi.fn();
const listPersonas = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        render: {
            listSegments: (...args: unknown[]) => listSegments(...args),
            createSegment: (...args: unknown[]) => createSegment(...args),
            scanTheSegmentInbox: (...args: unknown[]) => scanTheSegmentInbox(...args),
            listVoices: (...args: unknown[]) => listVoices(...args),
            deleteSegment: (...args: unknown[]) => deleteSegment(...args),
            scopeSegment: (...args: unknown[]) => scopeSegment(...args),
        },
        schedule: { listSchedule: (...args: unknown[]) => listSchedule(...args) },
        personas: { listPersonas: (...args: unknown[]) => listPersonas(...args) },
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

    it('knows a jingle is something the station plays, before any has been uploaded', async () => {
        // `jingle` is a kind the station draws by itself between records, so the first one uploaded is
        // not a new hour on the format clock and must not be warned about as one.
        listSegments.mockResolvedValue({ segments: [] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        const user = setupUser();
        await user.click(await screen.findByRole('button', { name: 'Upload' }));
        const kind = screen.getByRole('combobox', { name: /^Kind/ });
        await user.clear(kind);
        await user.type(kind, 'jingle');
        expect(screen.queryByText(/holds nothing of this kind yet/)).not.toBeInTheDocument();

        await user.clear(kind);
        await user.type(kind, 'sponsor');
        expect(screen.getByText(/holds nothing of this kind yet/)).toBeInTheDocument();
    });

    it('will not plan one with nothing to say', async () => {
        listSegments.mockResolvedValue({ segments: [] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        await setupUser().click(await screen.findByRole('button', { name: 'Write one' }));

        expect(screen.getByRole('button', { name: 'Plan it' })).toBeDisabled();
    });

    // The dialog stays open on a failure, which is right, and it used to stay open saying nothing:
    // the button simply seemed not to work.
    it('reports a failed delete inside the dialog, and leaves it open', async () => {
        listSegments.mockResolvedValue({ segments: [segment()] });
        listVoices.mockResolvedValue({ voices: [] });
        deleteSegment.mockRejectedValue(new Error('offline'));
        const user = setupUser();
        render(<SegmentsPage />);

        await user.click(await screen.findByRole('button', { name: 'Delete Top of hour' }));
        await user.click(await screen.findByRole('button', { name: 'Delete the recording' }));

        expect(await screen.findByText('The recording could not be deleted')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete the recording' })).toBeInTheDocument();
    });

    it('says what an empty library means rather than showing a bare table', async () => {
        listSegments.mockResolvedValue({ segments: [] });
        listVoices.mockResolvedValue({ voices: [] });

        render(<SegmentsPage />);

        expect(await screen.findByText('The station has no segments')).toBeInTheDocument();
    });

    describe('which shows a recording is for', () => {
        const SLOT = '22222222-2222-4222-8222-222222222222';
        const PERSONA = '33333333-3333-4333-8333-333333333333';

        const shows = () => {
            listSchedule.mockResolvedValue({ slots: [{ id: SLOT, label: 'Breakfast', startsAtMinutes: 360, endsAtMinutes: 600 }] });
            listPersonas.mockResolvedValue({ personas: [{ id: PERSONA, key: 'wayne', label: 'Wayne' }] });
        };

        it('says a recording with no scope is for every show, without reading the schedule', async () => {
            listSegments.mockResolvedValue({ segments: [segment()] });
            listVoices.mockResolvedValue({ voices: [] });

            render(<SegmentsPage />);

            expect(await screen.findByText('Every show')).toBeInTheDocument();
            expect(listSchedule).not.toHaveBeenCalled();
            expect(listPersonas).not.toHaveBeenCalled();
        });

        it('names the shows and presenters a scoped recording is for', async () => {
            shows();
            listSegments.mockResolvedValue({ segments: [segment({ slotIds: [SLOT], personaIds: [PERSONA] })] });
            listVoices.mockResolvedValue({ voices: [] });

            render(<SegmentsPage />);

            expect(await screen.findByText('Breakfast')).toBeInTheDocument();
            expect(await screen.findByText('Wayne')).toBeInTheDocument();
            expect(screen.queryByText('Every show')).not.toBeInTheDocument();
        });

        it('offers no scope on something the station rendered itself', async () => {
            listSegments.mockResolvedValue({ segments: [segment({ source: 'render', label: 'A link' })] });
            listVoices.mockResolvedValue({ voices: [] });

            render(<SegmentsPage />);
            await screen.findByText('A link');

            expect(screen.queryByText('Every show')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Choose the shows A link is for' })).not.toBeInTheDocument();
        });

        it('saves the shows chosen and draws the row with them', async () => {
            shows();
            listSegments.mockResolvedValue({ segments: [segment()] });
            listVoices.mockResolvedValue({ voices: [] });
            scopeSegment.mockResolvedValue(segment({ slotIds: [SLOT] }));
            const user = setupUser();
            render(<SegmentsPage />);

            await user.click(await screen.findByRole('button', { name: 'Choose the shows Top of hour is for' }));
            await waitFor(() => expect(screen.getByLabelText('Shows', { selector: 'input:not([type=hidden])' })).not.toBeDisabled());
            await user.click(screen.getByLabelText('Shows', { selector: 'input:not([type=hidden])' }));
            await user.click(await screen.findByRole('option', { name: 'Breakfast' }));
            await user.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() => {
                expect(scopeSegment).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', { slotIds: [SLOT], personaIds: [] });
            });
            expect(await screen.findByText('Breakfast')).toBeInTheDocument();
            expect(screen.queryByText('Every show')).not.toBeInTheDocument();
        });
    });
});
