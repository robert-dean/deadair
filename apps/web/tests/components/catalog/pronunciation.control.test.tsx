// Saying an artist's name from their page. What is worth pinning is which write it makes: a name with
// no entry is added, and a name the lexicon already holds in any state is rewritten and made active,
// since adding a second entry for the same written form is refused by the API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pronunciation } from '@deadair/sdk';

import { PronunciationControl } from '../../../src/components/catalog/pronunciation.control';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listPronunciations = vi.fn();
const createPronunciation = vi.fn();
const updatePronunciation = vi.fn();
const setPronunciationState = vi.fn();
const samplePronunciation = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        render: {
            listPronunciations: (...args: unknown[]) => listPronunciations(...args),
            createPronunciation: (...args: unknown[]) => createPronunciation(...args),
            updatePronunciation: (...args: unknown[]) => updatePronunciation(...args),
            setPronunciationState: (...args: unknown[]) => setPronunciationState(...args),
            samplePronunciation: (...args: unknown[]) => samplePronunciation(...args),
        },
    },
}));

const ID = '11111111-1111-4111-8111-111111111111';

const entry = (over: Partial<Pronunciation> = {}): Pronunciation => ({
    id: ID,
    written: 'W.A.S.P.',
    spoken: 'wasp',
    state: 'active',
    origin: 'operator',
    createdAt: '2026-10-19T00:00:00.000Z',
    ...over,
});

beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:sample');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    samplePronunciation.mockResolvedValue({ contentType: 'audio/mpeg', data: new Blob(['x']) });
    createPronunciation.mockResolvedValue({ pronunciations: [entry()] });
    updatePronunciation.mockResolvedValue({ pronunciations: [entry()] });
    setPronunciationState.mockResolvedValue({ pronunciations: [entry()] });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('PronunciationControl', () => {
    it('adds an entry for a name the station has none for', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [] });
        const user = setupUser();

        render(<PronunciationControl name="W.A.S.P." />);
        await user.click(await screen.findByRole('button', { name: 'Pronunciation' }));
        await user.type(screen.getByLabelText('Say W.A.S.P. as'), 'wasp');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(createPronunciation).toHaveBeenCalledWith({ written: 'W.A.S.P.', spoken: 'wasp' }));
        expect(updatePronunciation).not.toHaveBeenCalled();
    });

    it('says how an active entry reads, and rewrites it in place, matching the name whatever its case', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [entry({ written: 'w.a.s.p.' })] });
        const user = setupUser();

        render(<PronunciationControl name="W.A.S.P." />);
        expect(await screen.findByText('Said "wasp"')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Change' }));
        const field = screen.getByLabelText('Say W.A.S.P. as');
        expect(field).toHaveValue('wasp');
        await user.clear(field);
        await user.type(field, 'W A S P');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updatePronunciation).toHaveBeenCalledWith(ID, { written: 'w.a.s.p.', spoken: 'W A S P' }));
        expect(setPronunciationState).not.toHaveBeenCalled();
        expect(createPronunciation).not.toHaveBeenCalled();
    });

    it('accepts a proposal as it stands without rewriting its words', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [entry({ state: 'suggested', origin: 'gloss' })] });
        const user = setupUser();

        render(<PronunciationControl name="W.A.S.P." />);
        await user.click(await screen.findByRole('button', { name: 'Pronunciation proposed' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(setPronunciationState).toHaveBeenCalledWith(ID, { state: 'active' }));
        expect(updatePronunciation).not.toHaveBeenCalled();
    });

    it('brings a turned-down entry back rather than adding a second one the API would refuse', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [entry({ state: 'rejected', origin: 'gloss' })] });
        const user = setupUser();

        render(<PronunciationControl name="W.A.S.P." />);
        await user.click(await screen.findByRole('button', { name: 'Pronunciation' }));
        await user.type(screen.getByLabelText('Say W.A.S.P. as'), '!');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(setPronunciationState).toHaveBeenCalledWith(ID, { state: 'active' }));
        expect(updatePronunciation).toHaveBeenCalledWith(ID, { written: 'W.A.S.P.', spoken: 'wasp!' });
        expect(createPronunciation).not.toHaveBeenCalled();
    });

    it('speaks the draft before it is saved', async () => {
        listPronunciations.mockResolvedValue({ pronunciations: [] });
        const user = setupUser();

        render(<PronunciationControl name="W.A.S.P." />);
        await user.click(await screen.findByRole('button', { name: 'Pronunciation' }));
        await user.type(screen.getByLabelText('Say W.A.S.P. as'), 'wasp');
        await user.click(screen.getByRole('button', { name: 'Hear how W.A.S.P. is said' }));

        await waitFor(() => expect(samplePronunciation).toHaveBeenCalledWith({ written: 'W.A.S.P.', spoken: 'wasp' }));
    });
});
