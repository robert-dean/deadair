import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AttentionItem } from '@deadair/sdk';

import { attentionAcross, attentionCounts } from '../../../src/components/shell/attention.destination';
import { HeaderDestinations, HeaderPinned } from '../../../src/components/shell/header.nav';
import { render } from '../../utils/render';

let pathname = '/voice';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) => select({ location: { pathname } }),
    Link: ({ to, children, search: _search, ...props }: { to: string; search?: unknown; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

const item = (route: string, severity: AttentionItem['severity'] = 'warning'): AttentionItem =>
    ({ code: route, severity, title: route, detail: '', route }) as AttentionItem;

describe('HeaderDestinations', () => {
    it('draws the four destinations, marking the one the page is inside', () => {
        pathname = '/voice';
        render(<HeaderDestinations attention={[]} />);

        for (const name of ['Desk', 'Programme', 'Library', 'Voice']) {
            expect(screen.getByRole('link', { name })).toBeInTheDocument();
        }
        expect(screen.getByRole('link', { name: 'Voice' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Desk' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('title', 'Press l');
    });

    it('badges a destination with everything waiting anywhere inside it', () => {
        pathname = '/';
        render(<HeaderDestinations attention={[item('/catalog'), item('/catalog?state=benched')]} />);

        expect(screen.getByRole('link', { name: 'Library, 2 things need attention' })).toBeInTheDocument();
    });
});

describe('HeaderPinned', () => {
    it('draws Check-up and Settings, with what a plugin wants counted against Settings', () => {
        pathname = '/settings/station';
        render(<HeaderPinned attention={[item('/plugins', 'failure')]} />);

        expect(screen.getByRole('link', { name: 'Check-up' })).toBeInTheDocument();
        const settings = screen.getByRole('link', { name: 'Settings, 1 thing needs attention' });
        expect(settings).toHaveAttribute('aria-current', 'page');
    });
});

describe('attentionAcross', () => {
    it('adds each path once and keeps the worst severity', () => {
        const counts = new Map([
            ['/catalog/tracks', { count: 2, severity: 'notice' as const }],
            ['/playlists', { count: 1, severity: 'failure' as const }],
        ]);
        const total = attentionAcross(counts, {
            to: '/catalog/tracks',
            sections: [{ to: '/catalog/tracks' }, { to: '/playlists' }],
        });

        expect(total).toEqual({ count: 3, severity: 'failure' });
    });

    it('is nothing when nothing in the destination is waiting', () => {
        expect(attentionAcross(attentionCounts([]), { to: '/voice', sections: [{ to: '/voice' }] })).toBeUndefined();
    });
});
