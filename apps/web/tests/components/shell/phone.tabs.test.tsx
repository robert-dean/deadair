import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PhoneTabs } from '../../../src/components/shell/phone.tabs';
import { render, screen } from '../../utils/render';

// The bar is exercised without a router: only `Link` is reached, and only to render an anchor.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

describe('PhoneTabs', () => {
    it('offers the four destinations, and only those', () => {
        render(<PhoneTabs />);

        const labels = ['Desk', 'Programme', 'Library', 'Voice'];
        for (const label of labels) {
            expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
        }
        expect(screen.getAllByRole('link')).toHaveLength(labels.length);
    });

    /**
     * The desktop rail draws a mono letter beside each destination because `side.nav.tsx` binds it
     * as a real keyboard shortcut. A phone has no keyboard, so this bar deliberately does not mirror
     * that: no letter, decorative or otherwise, should render alongside the label.
     */
    it('draws no keycap beside a label, because a phone has no keyboard to press it on', () => {
        render(<PhoneTabs />);

        for (const hint of ['D', 'P', 'L', 'V']) {
            expect(screen.queryByText(hint)).not.toBeInTheDocument();
        }
    });
});
