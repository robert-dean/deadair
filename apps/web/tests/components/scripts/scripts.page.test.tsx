// The page decides nothing about what the station wrote: the rows, their outcomes and their order
// are the API's. What is tested here is the narrowing — that naming a break reaches the API as a
// query rather than as a client-side sieve, and that a break nothing has written for reads as that
// rather than as a filter somebody should clear.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ScriptAttempt } from '@deadair/sdk';

import { ScriptsPage } from '../../../src/components/scripts/scripts.page';
import { render, screen } from '../../utils/render';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, ...rest }: { children?: ReactNode }) => (
        <a href="/scripts" {...rest}>
            {children}
        </a>
    ),
}));

const history = vi.fn();

vi.mock('../../../src/api/scripts.queries', () => ({
    useScriptHistory: (filter: unknown) => history(filter),
}));

const attempt = (over: Partial<ScriptAttempt> = {}): ScriptAttempt => ({
    id: 'att-1',
    at: '2026-08-13T03:14:15.926Z',
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
});
