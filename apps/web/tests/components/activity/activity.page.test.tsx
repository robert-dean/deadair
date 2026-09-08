// The page decides nothing about what happened: the sentences, the ordering and the severity all
// come from the API, which unions three tables to produce them. So what is tested here is the two
// judgements the console does make — that an `info` line is not painted as a fault, and that a
// filter that matches nothing says so differently from a station that has done nothing yet.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { userEvent } from '@testing-library/user-event';
import type { ActivityEntry } from '@deadair/sdk';

import { ActivityPage } from '../../../src/components/activity/activity.page';
import { render, screen, setupUser } from '../../utils/render';

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: 'evt-1',
    at: DateTime.fromISO('2026-08-13T03:14:15.926Z'),
    module: 'playout',
    kind: 'silence.cause',
    severity: 'info',
    detail: 'The station was stood down, so it is holding nothing and airing nothing.',
    ...over,
});

const feed = vi.fn();

vi.mock('../../../src/api/activity.queries', () => ({
    useActivity: (filter: unknown) => feed(filter),
}));

// A line links to whatever it is about, and a real Link wants a router context this render helper
// deliberately does not build. The href is composed so the cases below can say where each one goes.
vi.mock('@tanstack/react-router', () => ({
    Link: ({
        to,
        params,
        search,
        children,
        ...rest
    }: {
        to: string;
        params?: Record<string, string>;
        search?: Record<string, string>;
        children?: ReactNode;
    }) => {
        const path = Object.entries(params ?? {}).reduce((built, [key, value]) => built.replace(`$${key}`, value), to);
        const query = new URLSearchParams(search ?? {}).toString();
        return (
            <a href={query === '' ? path : `${path}?${query}`} {...rest}>
                {children}
            </a>
        );
    },
}));

const answer = (entries: ActivityEntry[], over: Record<string, unknown> = {}) => ({
    data: { pages: [{ entries }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...over,
});

describe('ActivityPage', () => {
    it('says what happened, in the words the station used', () => {
        feed.mockReturnValue(answer([entry()]));

        render(<ActivityPage />);

        expect(screen.getByText('The station was stood down, so it is holding nothing and airing nothing.')).toBeInTheDocument();
        expect(screen.getByText('playout')).toBeInTheDocument();
    });

    it('does not paint a station that is only waiting', () => {
        // The same argument the `ready` badge exists on: a station idling for want of a listener and
        // one that cannot reach its stream are both silent, and only one is something to go and fix.
        feed.mockReturnValue(answer([entry(), entry({ id: 'evt-2', severity: 'fault', detail: "Liquidsoap's control API is not answering." })]));

        render(<ActivityPage />);

        const waiting = screen.getByText('The station was stood down, so it is holding nothing and airing nothing.');
        const fault = screen.getByText("Liquidsoap's control API is not answering.");

        // Mantine's `c` renders as an inline `color`, so the assertion is that the fault carries one
        // at all and the waiting line carries none.
        expect(fault.getAttribute('style')).toContain('color: var(--mantine-color-red-text)');
        expect(waiting.getAttribute('style') ?? '').not.toContain('color:');
    });

    // The feed already carried both ids and drew neither, so reading it meant retyping a title into
    // the catalog. The sentence is untouched: the link is a separate affordance built from the ids.
    it('reaches the record a line is about, and the words behind a break', () => {
        feed.mockReturnValue(
            answer([
                entry({ id: 'evt-1', module: 'playout', kind: 'track.aired', detail: 'Windowlicker by Aphex Twin aired.', trackId: 'trk_1' }),
                entry({ id: 'evt-2', module: 'render', kind: 'segment.ready', detail: 'A talk break was spoken and is ready.', segmentId: 'seg_1' }),
            ]),
        );

        render(<ActivityPage />);

        expect(screen.getByRole('link', { name: 'the record' })).toHaveAttribute('href', '/catalog/tracks/trk_1');
        // The mock router below has no `stripSearchParams`, so the defaults a real console
        // strips back out of the URL are spelled out here. Verified in the browser: the href
        // this actually renders is the short one.
        expect(screen.getByRole('link', { name: 'what was said' })).toHaveAttribute('href', '/voice?tab=said&segment=seg_1&persona=');
    });

    // Most of the feed is the station talking about itself: a gate opening is about neither a record
    // nor a break, and a line that offered a link would be offering one into nothing.
    it('offers nothing to click on a line about the station itself', () => {
        feed.mockReturnValue(answer([entry()]));

        render(<ActivityPage />);

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('tells an empty station apart from an empty filter', async () => {
        feed.mockReturnValue(answer([]));
        const user = setupUser();

        render(<ActivityPage />);
        expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();

        await user.click(screen.getByText('Faults'));
        expect(screen.getByText('Nothing matches that filter.')).toBeInTheDocument();
    });

    it('asks the API for the filter rather than narrowing the page it already has', async () => {
        // The feed is paged, so a console that filtered what it held would answer "no faults" from
        // one page of a history that has plenty.
        feed.mockReturnValue(answer([entry()]));
        const user = setupUser();

        render(<ActivityPage />);
        await user.click(screen.getByText('Breaks'));

        expect(feed).toHaveBeenLastCalledWith({ module: 'render' });
    });
});
