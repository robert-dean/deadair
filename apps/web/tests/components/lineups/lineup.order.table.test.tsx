// `committed` is the API's own answer to whether a line can still be edited: everything at or
// before the cursor has been handed to the player and answers 422 to every edit. What is tested
// here is that the table follows that answer rather than restating the rule.

import { describe, expect, it, vi } from 'vitest';

import { LineupOrderTable } from '../../../src/components/lineups/lineup.order.table';
import { lineupItem } from '../../utils/lineup.fixture';
import { render, screen } from '../../utils/render';

const items = [
    lineupItem({ id: 'line-1', title: 'Windowlicker', committed: true }),
    lineupItem({ id: 'line-2', title: 'Come to Daddy' }),
    lineupItem({ id: 'line-3', title: 'Xtal' }),
];

describe('LineupOrderTable', () => {
    it('renders the whole order, aired lines included', () => {
        // What has aired is how an operator reads where the station is in the plan, so it stays
        // on the page rather than being trimmed off the top.
        render(<LineupOrderTable items={items} cursor={1} />);

        expect(screen.getByText('Windowlicker')).toBeInTheDocument();
        expect(screen.getByText('Xtal')).toBeInTheDocument();
        expect(screen.getByText('aired')).toBeInTheDocument();
    });

    it('offers no controls at all when the caller cannot act', () => {
        render(<LineupOrderTable items={items} cursor={1} />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers a drop on uncommitted lines and none on aired ones', () => {
        const onRemove = vi.fn();

        render(<LineupOrderTable items={items} cursor={1} onRemove={onRemove} />);

        // Not a disabled control on the aired line: an affordance that could only ever answer 422
        // is worse than no affordance.
        expect(screen.queryByRole('button', { name: 'Drop Windowlicker' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Drop Come to Daddy' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Drop Xtal' })).toBeInTheDocument();
    });

    it('hands back the item, not its index, so the same track twice stays two lines', () => {
        const onRemove = vi.fn();
        const twice = [lineupItem({ id: 'line-1', title: 'Xtal' }), lineupItem({ id: 'line-2', title: 'Xtal' })];

        render(<LineupOrderTable items={twice} cursor={0} onRemove={onRemove} />);
        screen.getAllByRole('button', { name: 'Drop Xtal' })[1]?.click();

        expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-2' }));
    });
});
