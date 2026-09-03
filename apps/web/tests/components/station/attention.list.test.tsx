// The list is where the station's own sentences are shown, so what is worth testing here is the
// three things the console decides for itself: that a row's evidence is reachable and reads as the
// station wrote it, that a shorter list than the count says so, and that a row does not offer a
// button to the page it is being drawn on.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@deadair/sdk';

import { AttentionList } from '../../../src/components/station/attention.list';
import { render, screen, setupUser, waitFor } from '../../utils/render';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => {
        const path = Object.entries(params ?? {}).reduce((built, [key, value]) => built.replace(`$${key}`, value), to);
        // `href` after the spread, not before it: Mantine's `Anchor` hands `renderRoot` an
        // `href: undefined` of its own, and the real router's `Link` is what resolves the address.
        return (
            <a {...rest} href={path}>
                {children}
            </a>
        );
    },
}));

const item = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
    code: 'benchedCopies',
    severity: 'warning',
    title: '4 records have no copy left that will play',
    detail: 'Every copy of them has been written off.',
    route: '/catalog?state=benched',
    ...overrides,
});

describe('AttentionList', () => {
    it('says nothing needs anybody rather than drawing an empty card', () => {
        render(<AttentionList items={[]} />);

        expect(screen.getByText(/Nothing needs you/)).toBeInTheDocument();
    });

    it("keeps the evidence closed until it is asked for, then shows the station's own reason", async () => {
        const user = setupUser();
        render(
            <AttentionList
                items={[
                    item({
                        count: 4,
                        evidence: [
                            {
                                label: 'Push It — Salt-N-Pepa',
                                reason: 'The provider will never serve this copy.',
                                route: '/catalog/tracks/d8cbe47c-301f-401d-b4b3-a10794defd33',
                            },
                        ],
                    }),
                ]}
            />,
        );

        expect(screen.queryByText('The provider will never serve this copy.')).not.toBeInTheDocument();

        const toggle = screen.getByRole('button', { name: 'Show what failed' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        const panelId = toggle.getAttribute('aria-controls');
        expect(panelId).toBeTruthy();

        await user.click(toggle);

        expect(screen.getByRole('button', { name: 'Hide what failed' })).toHaveAttribute('aria-expanded', 'true');
        // Same control, now announced as open — and the id it names is the panel that just showed.
        expect(toggle).toHaveAttribute('aria-controls', panelId);
        expect(document.getElementById(panelId as string)).toBeInTheDocument();
        expect(screen.getByText('Push It — Salt-N-Pepa')).toBeInTheDocument();
        expect(screen.getByText('The provider will never serve this copy.')).toBeInTheDocument();
        // Through `waitFor` because the panel animates open: until the collapse settles the link is
        // in the document and not yet in the accessibility tree, which is why a role query for it
        // races where the text queries above do not.
        await waitFor(() =>
            expect(screen.getByRole('link', { name: 'Record →' })).toHaveAttribute('href', '/catalog/tracks/d8cbe47c-301f-401d-b4b3-a10794defd33'),
        );
    });

    it('says how many it is not showing, because the station caps what it sends', async () => {
        const user = setupUser();
        render(<AttentionList items={[item({ count: 40, evidence: [{ label: 'One', reason: 'because' }] })]} />);

        await user.click(screen.getByRole('button', { name: 'Show what failed' }));

        expect(screen.getByText('… and 39 more')).toBeInTheDocument();
    });

    it('draws no evidence control for a row the station sent none for', () => {
        render(<AttentionList items={[item({ code: 'streamUnreachable', severity: 'failure', route: '/onair' })]} />);

        expect(screen.queryByRole('button', { name: 'Show what failed' })).not.toBeInTheDocument();
    });

    it('offers no button to the page the list is drawn on', () => {
        // The desk IS what `/onair` resolves to, so every row about the broadcast used to carry a
        // `Desk →` button that navigated nowhere.
        render(<AttentionList items={[item({ code: 'unavailableItems', route: '/onair' })]} here="/" />);

        expect(screen.queryByRole('link', { name: /Desk/ })).not.toBeInTheDocument();

        render(<AttentionList items={[item({ code: 'unavailableItems', route: '/onair' })]} />);

        expect(screen.getByRole('link', { name: 'Desk →' })).toBeInTheDocument();
    });
});
