// The lexicon page's samples. What is worth pinning is WHAT gets spoken: the entry's own words rather
// than whatever the lexicon currently holds, so a proposal can be heard before it is accepted and a
// respelling while it is still being typed, and nothing is asked of the engine for an entry with no
// words to say.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pronunciation } from '@deadair/sdk';

import { PronunciationsPage } from '../../../src/components/pronunciations/pronunciations.page';
import { stubPhoneMedia } from '../../utils/phone';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listPronunciations = vi.fn();
const listVoices = vi.fn();
const samplePronunciation = vi.fn();
const setPronunciationState = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        render: {
            listPronunciations: (...args: unknown[]) => listPronunciations(...args),
            listVoices: (...args: unknown[]) => listVoices(...args),
            samplePronunciation: (...args: unknown[]) => samplePronunciation(...args),
            setPronunciationState: (...args: unknown[]) => setPronunciationState(...args),
        },
    },
}));

const entry = (over: Partial<Pronunciation> = {}): Pronunciation => ({
    id: '11111111-1111-4111-8111-111111111111',
    written: 'Röyksopp',
    spoken: 'royk-sop',
    state: 'active',
    origin: 'operator',
    createdAt: '2026-10-19T00:00:00.000Z',
    ...over,
});

beforeEach(() => {
    // jsdom has neither, and the preview hook plays through both.
    URL.createObjectURL = vi.fn(() => 'blob:sample');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    listVoices.mockResolvedValue({ voices: [] });
    samplePronunciation.mockResolvedValue({ contentType: 'audio/mpeg', data: new Blob(['x']) });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('PronunciationsPage samples', () => {
    it('speaks an entry as it stands, in the default voice when none is chosen', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [entry()] });
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.click(await screen.findByRole('button', { name: 'Hear how Röyksopp is said' }));

        await waitFor(() => expect(samplePronunciation).toHaveBeenCalledWith({ written: 'Röyksopp', spoken: 'royk-sop' }));
    });

    it('speaks a proposal before it is accepted', async () => {
        listPronunciations.mockResolvedValue({
            pronunciations: [entry({ state: 'suggested', origin: 'gloss', written: 'Unger', spoken: 'UN-guhr' })],
        });
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.click(await screen.findByRole('button', { name: 'Hear how Unger is said' }));

        await waitFor(() => expect(samplePronunciation).toHaveBeenCalledWith({ written: 'Unger', spoken: 'UN-guhr' }));
    });

    it('speaks a respelling that is still being typed', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [] });
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.type(await screen.findByRole('textbox', { name: 'Written' }), 'Sade');
        await user.type(screen.getByRole('textbox', { name: 'Said' }), 'Shar-day');
        await user.click(screen.getByRole('button', { name: 'Hear how Sade is said' }));

        await waitFor(() => expect(samplePronunciation).toHaveBeenCalledWith({ written: 'Sade', spoken: 'Shar-day' }));
    });

    it('offers nothing to hear for an entry that drops the words', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [entry({ written: '(Remastered)', spoken: '' })] });

        render(<PronunciationsPage />);

        expect(await screen.findByRole('button', { name: 'Hear how (Remastered) is said' })).toBeDisabled();
    });

    it('says so beside the section when the engine could not speak it', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [entry()] });
        samplePronunciation.mockRejectedValue(new Error('engine refused'));
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.click(await screen.findByRole('button', { name: 'Hear how Röyksopp is said' }));

        expect(await screen.findByText(/engine refused|could not be spoken/)).toBeInTheDocument();
    });
});

describe('PronunciationsPage proposals', () => {
    const proposals = [
        entry({ state: 'suggested', origin: 'gloss' }),
        entry({ id: '22222222-2222-4222-8222-222222222222', written: 'Sigur Rós', spoken: 'see-gur rohss', state: 'suggested', origin: 'gloss' }),
    ];

    // A failed accept used to redraw nothing at all: the proposal simply stayed where it was.
    it('says so when a proposal could not be accepted', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: proposals });
        setPronunciationState.mockRejectedValue(new Error('offline'));
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.click(await screen.findByRole('button', { name: 'Say Röyksopp this way' }));

        expect(await screen.findByText('That pronunciation could not be changed')).toBeInTheDocument();
    });

    it('shows only the row being accepted as busy', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: proposals });
        setPronunciationState.mockReturnValue(new Promise(() => undefined));
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.click(await screen.findByRole('button', { name: 'Say Röyksopp this way' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Say Röyksopp this way' })).toHaveAttribute('data-loading'));
        expect(screen.getByRole('button', { name: 'Say Sigur Rós this way' })).not.toHaveAttribute('data-loading');
    });
});

// The tables were 600px wide, so on a 375px phone every row's buttons sat past the right edge. A
// phone draws a card per entry instead, with the same buttons on it.
describe('PronunciationsPage on a phone', () => {
    let restore: (() => void) | undefined;
    afterEach(() => {
        restore?.();
        restore = undefined;
    });

    it("draws every section as cards, with each entry's buttons on its card", async () => {
        restore = stubPhoneMedia();
        listPronunciations.mockResolvedValue({
            pronunciations: [
                entry(),
                entry({ id: '33333333-3333-4333-8333-333333333333', state: 'suggested', origin: 'gloss', written: 'Unger', spoken: 'UN-guhr' }),
                entry({ id: '44444444-4444-4444-8444-444444444444', state: 'rejected', origin: 'gloss', written: 'Sade', spoken: 'sayd' }),
            ],
        });

        const { container } = render(<PronunciationsPage />);

        expect(await screen.findByRole('button', { name: 'Edit Röyksopp' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Röyksopp' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Say Unger this way' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn down Unger' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Say it' })).toBeInTheDocument();
        expect(container.querySelector('table')).toBeNull();
    });

    it('edits an entry in place on its card', async () => {
        restore = stubPhoneMedia();
        listPronunciations.mockResolvedValue({ pronunciations: [entry()] });
        const user = setupUser();

        render(<PronunciationsPage />);
        await user.click(await screen.findByRole('button', { name: 'Edit Röyksopp' }));

        // The add form below holds a "Written" field of its own, so the edit field is the one with the entry in it.
        expect(screen.getByDisplayValue('Röyksopp')).toHaveAccessibleName('Written');
        expect(screen.getByRole('textbox', { name: 'Spoken' })).toHaveValue('royk-sop');
    });
});
