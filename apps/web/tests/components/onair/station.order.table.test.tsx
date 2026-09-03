// The table mounts a WINDOW of the order rather than all of it, and these cases are about the
// windowing itself: that a long order does not mount a row per item, that the numbering and the
// fold survive the slicing, and that the pin — hold the item on air under the header, let go when
// the operator scrolls — still behaves with the anchor row possibly not in the document at all.
// What the rows SAY is covered by `tests/components/desk/desk.order.test.tsx`; nothing here asserts
// about states beyond finding the one on air.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { StationOrderItem } from '@deadair/sdk';

import { StationOrderTable, skipReading } from '../../../src/components/onair/station.order.table';
import { measureTheOrderPort } from '../../utils/order.port';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

// The table mounts a window of rows sized from the port's rect, and jsdom measures every rect at
// zero — without this the tbody is empty. The port answers 600px tall, and every row answers zero
// and falls back to the table's own 50px estimate, so the window is ~12 rows plus 8 of overscan
// each side: a fixture past ~40 rows is guaranteed to have unmounted items.
measureTheOrderPort();

// The row titles link into the catalog, which needs a router; the assertions here are about rows
// existing at all, so the mock only has to render an anchor. `href` is a stand-in rather than
// anything computed from `to`/`params` — nothing here follows the link anywhere — but it has to be
// SOME string: an `<a>` with none is not a focusable link at all, native or ARIA, which is exactly
// what the keyboard-reach cases below are asserting about.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, ...rest }: { children?: ReactNode }) => (
        <a href="#" {...rest}>
            {children}
        </a>
    ),
}));

const orderItem = (index: number, overrides: Partial<StationOrderItem> = {}): StationOrderItem => ({
    id: `item-${index}`,
    kind: 'track',
    state: 'planned',
    title: `Record ${index}`,
    artists: ['Aphex Twin'],
    durationMs: 366_000,
    pluginId: 'deadair.spotify',
    externalId: `track-${index}`,
    ...overrides,
});

/** `played` rows behind one on air, `planned` rows ahead of it. The anchor is at index `played`. */
const longOrder = (played: number, planned: number): StationOrderItem[] => [
    ...Array.from({ length: played }, (_, i) => orderItem(i, { state: 'played' })),
    orderItem(played, { state: 'airing' }),
    ...Array.from({ length: planned }, (_, i) => orderItem(played + 1 + i)),
];

/** Every `<tr>` the table has actually mounted. The spacer rows are `aria-hidden` and not counted. */
const mountedRows = (): HTMLElement[] => screen.getAllByRole('row');

describe('StationOrderTable: the window', () => {
    it('mounts a window of a long order rather than a row per item', () => {
        render(<StationOrderTable items={longOrder(0, 299)} />);

        // One header row plus the window. The point is the order of magnitude: three hundred items,
        // a mounted DOM in the dozens.
        const rows = mountedRows();
        expect(rows.length).toBeGreaterThan(10);
        expect(rows.length).toBeLessThan(60);
        expect(screen.getByText('Record 0')).toBeInTheDocument();
        expect(screen.queryByText('Record 250')).not.toBeInTheDocument();
    });

    it('numbers rows against the whole order while the history is folded', () => {
        render(<StationOrderTable items={longOrder(3, 2)} collapseHistory />);

        // The first visible row is the one on air, and it is row 4 of the broadcast: a first row
        // numbered 1 would quietly renumber everything behind the fold.
        expect(screen.getByRole('button', { name: /3 played earlier/ })).toBeInTheDocument();
        expect(screen.queryByText('Record 0')).not.toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.queryByText('1')).not.toBeInTheDocument();
    });

    it('survives the splice of opening the history, keys and numbering intact', async () => {
        render(<StationOrderTable items={longOrder(3, 2)} collapseHistory />);

        // Opening the fold prepends three rows, which moves every index at once — the case that
        // would scramble a measurement cache keyed by index rather than by item id.
        fireEvent.click(screen.getByRole('button', { name: /3 played earlier/ }));

        await waitFor(() => {
            expect(screen.getByText('Record 0')).toBeInTheDocument();
        });
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('on air')).toBeInTheDocument();
        expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('draws the row on air as the one lit row when it is in the window', () => {
        const { container } = render(<StationOrderTable items={longOrder(2, 2)} />);

        const lit = container.querySelectorAll('tbody tr[class*="airing"]');
        expect(lit).toHaveLength(1);
        expect(lit[0]).toHaveTextContent('Record 2');
    });
});

describe('StationOrderTable: the pin', () => {
    // Thirty rows of history put the anchor at offset 30 × 50px = 1500, well past the 600px port:
    // pinning genuinely has to scroll, and scrolling away genuinely unmounts the anchor.
    const items = longOrder(30, 29);
    const pinned = 1500;

    it('releases when the operator scrolls away, and offers the way back to the anchor offset', async () => {
        render(<StationOrderTable items={items} />);
        const port = screen.getByRole('region', { name: /Running order/ });

        // The mount pin's own scroll settles: a scroll event AT the pinned offset re-arms whoever
        // caused it, which is what frees the release below from waiting out the settle timer.
        port.scrollTop = pinned;
        fireEvent.scroll(port);
        expect(screen.queryByRole('button', { name: 'Back to what is on air' })).not.toBeInTheDocument();

        // The operator drags off into the history. The anchor row leaves the document — the button
        // and its target are arithmetic over the virtualizer, not a measurement of the row.
        port.scrollTop = 300;
        fireEvent.scroll(port);
        const back = await screen.findByRole('button', { name: 'Back to what is on air' });
        expect(screen.queryByText(`Record 30`)).not.toBeInTheDocument();

        const scrollTo = vi.fn();
        port.scrollTo = scrollTo;
        fireEvent.click(back);
        expect(scrollTo).toHaveBeenCalledWith({ top: pinned, behavior: 'smooth' });

        // Landing back at the pinned offset re-arms the follow and takes the button away.
        port.scrollTop = pinned;
        fireEvent.scroll(port);
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Back to what is on air' })).not.toBeInTheDocument();
        });
    });
});

// One boolean, `playable`, stands in front of seven segment states, and the row used to spend all
// seven of them on "will skip" — which on a full order meant nine rows announcing a failure that
// had not happened, because a break is written when it comes round rather than when it is planted.
// These are the three readings and the one case that must stay silent.
describe('what a break says about whether it will be heard', () => {
    const segment = (overrides: Partial<StationOrderItem> = {}): StationOrderItem =>
        orderItem(0, {
            kind: 'segment',
            segmentId: 'segment-1',
            title: 'Talk break',
            artists: [],
            playable: false,
            ...overrides,
        });

    it('says a break nobody has written yet is not written yet, rather than that it will be skipped', () => {
        for (const state of ['planned', 'writing'] as const) {
            const reading = skipReading(segment({ segmentState: state }));
            expect(reading?.label).toBe('not written yet');
            expect(reading?.colour).toBe('gray');
        }
    });

    it('separates words that exist from audio that does not', () => {
        for (const state of ['written', 'rendering'] as const) {
            expect(skipReading(segment({ segmentState: state }))?.label).toBe('no audio yet');
        }
    });

    // The one an operator can act on, and the only one that earns the tally's yellow.
    it('keeps will-skip for a break that failed, and carries the segment’s own reason', () => {
        const failed = skipReading(segment({ segmentState: 'failed', segmentError: 'the model declined it' }));
        expect(failed?.label).toBe('will skip');
        expect(failed?.colour).toBe('yellow');
        expect(failed?.hint).toBe('the model declined it');

        expect(skipReading(segment({ segmentState: 'gone' }))?.label).toBe('will skip');
    });

    // A record is never one of these, and neither is a break that has already been dealt with: the
    // badge is about what is still to come.
    it('says nothing about a record, a playable break, or a break that has already aired', () => {
        expect(skipReading(orderItem(0))).toBeUndefined();
        expect(skipReading(segment({ playable: true, segmentState: 'ready' }))).toBeUndefined();
        expect(skipReading(segment({ segmentState: 'failed', state: 'skipped' }))).toBeUndefined();
    });
});

// A row used to be five separate Tab stops — title, artist, rating, play next, drop — which made a
// thirty-item order roughly a hundred and fifty presses to reach the bottom. The row itself is now
// a stop and the two action icons drop out of the Tab order entirely, reachable only by the arrow
// keys these cases exercise.
describe('StationOrderTable: reaching a row by keyboard', () => {
    // A row rated by the catalog: title, artist and trackId all set, so every one of the row's five
    // original stops actually renders. Position 1 rather than 0, so it is not the next-up slot and
    // draws the play-next icon as well as drop — the row the finding was about.
    const rateable = (index: number, overrides: Partial<StationOrderItem> = {}): StationOrderItem =>
        orderItem(index, { trackId: `track-${index}`, artistId: `artist-${index}`, ...overrides });

    it('cuts a row from five Tab stops to the row plus its rating control', async () => {
        const user = setupUser();
        render(<StationOrderTable items={[rateable(0), rateable(1), rateable(2)]} onMove={() => {}} onRemove={() => {}} onRate={() => {}} />);

        // Starting on the middle row's title — the row with all five of the original stops — count
        // presses to the next row's title. Before this change that was five: artist, rating, play
        // next, drop, title. The two icons are no longer in the count at all.
        screen.getByRole('link', { name: 'Record 1' }).focus();
        let presses = 0;
        while (document.activeElement?.textContent !== 'Record 2' && presses < 10) {
            // eslint-disable-next-line no-await-in-loop
            await user.tab();
            presses += 1;
        }

        expect(document.activeElement?.textContent).toBe('Record 2');
        expect(presses).toBe(4);
        expect(presses).toBeLessThan(5);
    });

    it('rows with actions become their own Tab stop, ahead of the title', () => {
        render(<StationOrderTable items={[rateable(0)]} onMove={() => {}} onRemove={() => {}} onRate={() => {}} />);

        const row = screen.getAllByRole('row').find(candidate => within(candidate).queryByText('Record 0') !== null)!;
        expect(row).toHaveAttribute('tabIndex', '0');
    });

    it('moves focus among the row’s own elements on ArrowRight, without leaving the row', () => {
        // Every fixture row carries the same artist, so the assertions below are scoped `within`
        // this one row rather than found by name across the whole table.
        render(<StationOrderTable items={[rateable(0), rateable(1)]} onMove={() => {}} onRemove={() => {}} onRate={() => {}} />);

        const row = screen.getAllByRole('row').find(candidate => within(candidate).queryByText('Record 0') !== null)!;
        row.focus();
        expect(document.activeElement).toBe(row);

        // Row focus, with nothing yet chosen inside it, moves to the first stop: the title.
        fireEvent.keyDown(row, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(within(row).getByRole('link', { name: 'Record 0' }));

        // From the title, the next stop over is the artist.
        fireEvent.keyDown(row, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(within(row).getByRole('link', { name: 'Aphex Twin' }));
    });

    it('activates the title link on Enter when the row itself has focus', () => {
        render(<StationOrderTable items={[rateable(0)]} onMove={() => {}} onRemove={() => {}} onRate={() => {}} />);

        const titleLink = screen.getByRole('link', { name: 'Record 0' });
        const clicked = vi.fn();
        titleLink.addEventListener('click', clicked);

        const row = screen.getAllByRole('row').find(candidate => within(candidate).queryByText('Record 0') !== null)!;
        row.focus();
        fireEvent.keyDown(row, { key: 'Enter' });

        expect(clicked).toHaveBeenCalled();
    });
});
