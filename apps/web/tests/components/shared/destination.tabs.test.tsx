import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { DestinationTabs, type DestinationTab } from '../../../src/components/shared/destination.tabs';
import { render, setupUser } from '../../utils/render';

const TABS: readonly DestinationTab<'one' | 'two' | 'three'>[] = [
    { key: 'one', label: 'One', group: 'First' },
    { key: 'two', label: 'Two', group: 'First' },
    { key: 'three', label: 'Three', group: 'Second' },
];

describe('DestinationTabs', () => {
    it('draws every tab on a desk, with the selected one marked', () => {
        render(<DestinationTabs tabs={TABS} active="two" onSelect={() => {}} label="Sections" />);

        expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    });

    it('draws each group heading once, before its first tab, and not as a tab', () => {
        render(<DestinationTabs tabs={TABS} active="one" onSelect={() => {}} label="Sections" />);

        expect(screen.getAllByText('First')).toHaveLength(1);
        expect(screen.getAllByText('Second')).toHaveLength(1);
        expect(screen.queryByRole('tab', { name: 'First' })).not.toBeInTheDocument();
    });

    it('hands the pressed tab to the destination', async () => {
        const user = setupUser();
        const onSelect = vi.fn();
        render(<DestinationTabs tabs={TABS} active="one" onSelect={onSelect} label="Sections" />);

        await user.click(screen.getByRole('tab', { name: 'Three' }));

        expect(onSelect).toHaveBeenCalledWith('three');
    });

    it('counts what wants somebody on a tab, and names it for a screen reader', () => {
        render(
            <DestinationTabs
                tabs={TABS}
                active="one"
                onSelect={() => {}}
                label="Sections"
                attention={[undefined, { count: 2, severity: 'warning' }, { count: 0, severity: 'notice' }]}
            />,
        );

        expect(screen.getByRole('tab', { name: 'Two, 2 things need attention' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Three' })).toBeInTheDocument();
    });
});
