// A speech preview of a break that hit a pad is heard with the pad only when the board travels with
// the words, so what is sent is what this pins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSpeechPreview } from '../../src/api/voices.queries';

const previewSpeech = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: { render: { previewSpeech: (...args: unknown[]) => previewSpeech(...args) } },
}));

beforeEach(() => {
    previewSpeech.mockResolvedValue({ data: new Blob(['audio']) });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
});

afterEach(() => {
    previewSpeech.mockReset();
    vi.restoreAllMocks();
});

describe('fetchSpeechPreview', () => {
    it('sends the board a hit is played from', async () => {
        await fetchSpeechPreview('Ahoy. [sfx:cannon]', 'pirate', 'pirate-board');

        expect(previewSpeech).toHaveBeenCalledWith({ text: 'Ahoy. [sfx:cannon]', voice: 'pirate', soundboard: 'pirate-board' });
    });

    it('sends neither a voice nor a board it was not given', async () => {
        await fetchSpeechPreview('Ahoy.');

        expect(previewSpeech).toHaveBeenCalledWith({ text: 'Ahoy.' });
    });

    it('answers a URL to play the bytes with', async () => {
        expect(await fetchSpeechPreview('Ahoy.')).toBe('blob:preview');
    });
});
