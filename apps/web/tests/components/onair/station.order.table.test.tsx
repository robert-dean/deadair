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

import { StationOrderTable } from '../../../src/components/onair/station.order.table';
import { measureTheOrderPort } from '../../utils/order.port';
import { render, screen, waitFor } from '../../utils/render';

// The table mounts a window of rows sized from the port's rect, and jsdom measures every rect at
// zero — without this the tbody is empty. The port answers 600px tall, and every row answers zero
// and falls back to the table's own 50px estimate, so the window is ~12 rows plus 8 of overscan
// each side: a fixture past ~40 rows is guaranteed to have unmounted items.
measureTheOrderPort();

// The row titles link into the catalog, which needs a router; the assertions here are about rows
// existing at all, so the mock only has to render an anchor.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, ...rest }: { children?: ReactNode }) => <a {...rest}>{children}</a>,
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
        const port = screen.getByRole('region', { name: 'Running order' });

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
