// Where the callback route sends somebody once they are signed in. The API carries a path to return
// to through the identity provider as `?redirect=`; this page is a URL anybody can type, so the path
// is sanitised again here before it is followed.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../utils/render';

const state: { outcome: unknown; search: Record<string, string | undefined> } = { outcome: { kind: 'signed-in' }, search: {} };

vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: Record<string, unknown>) => ({
        ...options,
        useLoaderData: () => state.outcome,
        useSearch: () => state.search,
    }),
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
    useNavigate: () => vi.fn(),
}));

vi.mock('../../src/api/client', () => ({ sdk: {} }));

const { Route } = await import('../../src/routes/auth/callback');
const Component = (Route as unknown as { component: () => ReactNode }).component;

describe('/auth/callback once signed in', () => {
    it('goes to the path the sign-in started from', () => {
        state.search = { redirect: '/settings/security' };
        const { getByTestId } = render(<Component />);
        expect(getByTestId('navigate').textContent).toBe('/settings/security');
    });

    it('goes home for a return address that would leave the console', () => {
        state.search = { redirect: '//evil.example/' };
        const { getByTestId } = render(<Component />);
        expect(getByTestId('navigate').textContent).toBe('/');
    });

    it('goes home when no return address came back', () => {
        state.search = {};
        const { getByTestId } = render(<Component />);
        expect(getByTestId('navigate').textContent).toBe('/');
    });
});
