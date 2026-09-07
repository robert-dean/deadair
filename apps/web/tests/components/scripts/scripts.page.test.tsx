// The page decides nothing about what the station wrote: the rows, their outcomes and their order
// are the API's. What is tested here is the narrowing — that naming a break reaches the API as a
// query rather than as a client-side sieve, and that a break nothing has written for reads as that
// rather than as a filter somebody should clear.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { ScriptAttempt } from '@deadair/sdk';

import { ScriptsPage } from '../../../src/components/scripts/scripts.page';
import { render, screen, setupUser } from '../../utils/render';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, ...rest }: { children?: ReactNode }) => (
        <a href="/scripts" {...rest}>
            {children}
        </a>
    ),
}));

const history = vi.fn();
const rate = vi.fn();

vi.mock('../../../src/api/scripts.queries', () => ({
    useScriptHistory: (filter: unknown) => history(filter),
    useRateScript: () => ({ mutate: rate, isPending: false, variables: undefined }),
}));

const attempt = (over: Partial<ScriptAttempt> = {}): ScriptAttempt => ({
    id: 'att-1',
    at: DateTime.fromISO('2026-08-13T03:14:15.926Z'),
    kind: 'talkbreak',
    writer: 'model',
    outcome: 'written',
    script: 'That was Boards of Canada.',
    ...over,
});

const answer = (attempts: ScriptAttempt[]) => ({
    data: { pages: [{ attempts }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
});

describe('ScriptsPage', () => {
    it('asks for the whole history when no break was named', () => {
        history.mockReturnValue(answer([attempt()]));

        render(<ScriptsPage />);

        expect(history).toHaveBeenCalledWith(expect.not.objectContaining({ segmentId: expect.anything() }));
        expect(screen.getByText('Scripts')).toBeInTheDocument();
    });

    // The narrowing is a QUERY, so the pagination underneath it still means what it says. A page
    // that filtered what it had already loaded would say "load older" and then show nothing.
    it('asks the API for one break, and says that is what it is showing', () => {
        history.mockReturnValue(answer([attempt()]));

        render(<ScriptsPage segmentId="seg_1" />);

        expect(history).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 'seg_1' }));
        expect(screen.getByText('One break')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Read everything/ })).toBeInTheDocument();
    });

    // A break planted but not yet written is the ordinary state of anything past WRITE_AHEAD, and
    // it is not a filter anybody should go looking for.
    it('tells a break with nothing written for it apart from a filter that matches nothing', () => {
        history.mockReturnValue(answer([]));

        render(<ScriptsPage segmentId="seg_1" />);

        expect(screen.getByText(/Nothing has been written for this break yet/)).toBeInTheDocument();
    });
    /**
     * The row is a button that opens the detail, and the rating is a control inside the same line.
     * Nested they would be a button inside a button: invalid, and every thumb would also toggle the
     * collapse. Side by side, a thumb rates and nothing opens.
     */
    it('rates an attempt without opening it', async () => {
        history.mockReturnValue(answer([attempt({ id: 'sh_1', script: 'Here is a record.' })]));

        render(<ScriptsPage />);
        await setupUser().click(screen.getByLabelText('More like this'));

        expect(rate).toHaveBeenCalledWith({ id: 'sh_1', rating: 'liked' });
        // The detail carries the kind as a labelled fact, so its absence is the collapse still shut.
        expect(screen.queryByText('Kind')).not.toBeInTheDocument();
    });

    /** An attempt that produced no words is a question with no subject. */
    it('offers no opinion on an attempt that wrote nothing', () => {
        history.mockReturnValue(answer([attempt({ id: 'sh_2', script: undefined, outcome: 'declined', reason: 'The model declined.' })]));

        render(<ScriptsPage />);

        expect(screen.queryByLabelText('More like this')).not.toBeInTheDocument();
    });

    /** Absent is not neutral: most attempts have never been read back, and it has to look that way. */
    it('draws an unrated attempt with no answer selected', () => {
        history.mockReturnValue(answer([attempt({ id: 'sh_3', script: 'Here is a record.' })]));

        render(<ScriptsPage />);

        // No segment active at all, rather than neutral standing in for it. Scoped to the three
        // rating values, because the page's own filter chips are radios too and one of each of
        // those is always checked.
        const opinions = screen.getAllByRole('radio').filter(radio => ['liked', 'neutral', 'disliked'].includes((radio as HTMLInputElement).value));

        expect(opinions).toHaveLength(3);
        expect(opinions.some(radio => (radio as HTMLInputElement).checked)).toBe(false);
    });
});
