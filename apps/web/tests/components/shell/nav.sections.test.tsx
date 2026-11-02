// A long destination's rows in the rail. What is pinned is that a heading appears once per run rather
// than once per row, and that attention still lands on the row it belongs to, which is why the table
// stayed flat instead of being nested by group.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NavSections } from '../../../src/components/shell/nav.sections';
import type { NavSection } from '../../../src/components/shell/destinations';
import { render, screen } from '../../utils/render';

vi.mock('../../../src/components/shell/nav.item', () => ({
    NavItem: ({ label, attention }: { label: ReactNode; attention?: { count: number } }) => (
        <div>
            {label}
            {attention ? ` (${attention.count})` : ''}
        </div>
    ),
}));

const row = (label: string, group?: string): NavSection => ({ to: '/voice', label, ...(group === undefined ? {} : { group }) });

describe('NavSections', () => {
    it('heads each run once, and keeps attention on its own row', () => {
        render(
            <NavSections
                sections={[row('Characters', 'Who'), row('Voices', 'Who'), row('Segments', 'Sound')]}
                attention={[undefined, { count: 2, tone: 'bad' } as never, undefined]}
            />,
        );

        expect(screen.getAllByText('Who')).toHaveLength(1);
        expect(screen.getAllByText('Sound')).toHaveLength(1);
        expect(screen.getByText('Voices (2)')).toBeInTheDocument();
    });

    it('draws no heading for rows without a group', () => {
        render(<NavSections sections={[row('Tracks')]} attention={[]} />);

        expect(screen.getByText('Tracks')).toBeInTheDocument();
    });
});
