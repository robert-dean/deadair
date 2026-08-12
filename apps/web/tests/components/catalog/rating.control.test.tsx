// Three answers to one question, which is why this is a radio group rather than two toggles. The
// cases worth pinning are the ones an operator would notice and a snapshot would not: that
// withdrawing an opinion is reachable at all, and that a row's control names the record it is for
// — a page of fifty otherwise carries fifty controls called "Like".

import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { RatingControl } from '../../../src/components/catalog/rating.control';
import { render, screen } from '../../utils/render';

afterEach(() => {
    vi.resetAllMocks();
});

describe('RatingControl', () => {
    it('shows the opinion the row already carries', () => {
        render(<RatingControl rating="disliked" label="Vaka" onChange={vi.fn()} />);

        expect(screen.getByRole('radio', { name: 'Dislike Vaka' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Like Vaka' })).not.toBeChecked();
    });

    it('reads as no opinion when the row carries none at all', () => {
        render(<RatingControl label="Vaka" onChange={vi.fn()} />);

        expect(screen.getByRole('radio', { name: 'No opinion about Vaka' })).toBeChecked();
    });

    it('withdraws an opinion rather than only offering the two poles', async () => {
        const onChange = vi.fn();
        render(<RatingControl rating="liked" label="Vaka" onChange={onChange} />);

        await userEvent.click(screen.getByRole('radio', { name: 'No opinion about Vaka' }));

        expect(onChange).toHaveBeenCalledWith('neutral');
    });

    it('sends the opinion that was picked', async () => {
        const onChange = vi.fn();
        render(<RatingControl label="Vaka" onChange={onChange} />);

        await userEvent.click(screen.getByRole('radio', { name: 'Like Vaka' }));

        expect(onChange).toHaveBeenCalledWith('liked');
    });

    it('keeps showing the current answer while a write is in flight, and refuses a second one', async () => {
        const onChange = vi.fn();
        render(<RatingControl rating="liked" label="Vaka" busy onChange={onChange} />);

        expect(screen.getByRole('radio', { name: 'Like Vaka' })).toBeChecked();

        await userEvent.click(screen.getByRole('radio', { name: 'Dislike Vaka' }));

        expect(onChange).not.toHaveBeenCalled();
    });
});
