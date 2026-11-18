import { createFileRoute, stripSearchParams } from '@tanstack/react-router';

import { DEFAULT_PROGRAMME_TAB, isProgrammeTab, type ProgrammeTab } from '../../components/schedule/schedule.page';
import { ShowEditorPage } from '../../components/schedule/show.editor.page';

export interface NewShowSearch {
    /** The Programme tab the operator came from, which Back and a save return to. */
    from: ProgrammeTab;
    /** A special, asked for from the Specials tab, rather than a weekly show. */
    special: boolean;
    /** Where on the grid it was asked for, in minutes after midnight. Absent starts at six. */
    startsAt?: number;
    /** The weekday clicked on the grid, 0 for Sunday. Absent is every day. */
    day?: number;
}

const DEFAULTS: Pick<NewShowSearch, 'from' | 'special'> = { from: DEFAULT_PROGRAMME_TAB, special: false };

/** A whole number in a range, or nothing: what arrives on a URL is text, and a bad one is no prefill rather than an error. */
function wholeIn(value: unknown, min: number, max: number): number | undefined {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

/** A new show, weekly or special. See `ShowEditorPage` for why it is a page. */
export const Route = createFileRoute('/schedule/show/new')({
    component: NewShowRoute,
    validateSearch: (input: Record<string, unknown>): NewShowSearch => {
        const startsAt = wholeIn(input.startsAt, 0, 24 * 60 - 1);
        const day = wholeIn(input.day, 0, 6);
        return {
            from: isProgrammeTab(input.from) ? input.from : DEFAULT_PROGRAMME_TAB,
            special: input.special === true || input.special === 'true',
            ...(startsAt === undefined ? {} : { startsAt }),
            ...(day === undefined ? {} : { day }),
        };
    },
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function NewShowRoute() {
    const { from, special, startsAt, day } = Route.useSearch();

    return (
        <ShowEditorPage
            key={`${special}:${startsAt ?? ''}:${day ?? ''}`}
            open={{
                fresh: {
                    kind: 'new',
                    ...(special ? { special: true } : {}),
                    ...(startsAt === undefined ? {} : { startsAtMinutes: startsAt }),
                    ...(day === undefined ? {} : { days: [day] }),
                },
            }}
            from={from}
        />
    );
}
