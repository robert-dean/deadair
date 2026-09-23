// Where the callback route sends somebody once they are signed in. The API carries a path to return
// to through the identity provider as `?redirect=`; this page is a URL anybody can type, so the path
// is sanitised again here before it is followed.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../utils/render';

const state: { outcome: unknown; search: Record<string, string | undefined> } = { outcome: { kind: 'signed-in' }, search: {} };
const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: Record<string, unknown>) => ({
        ...options,
        useLoaderData: () => state.outcome,
        useSearch: () => state.search,
    }),
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
    useNavigate: () => navigate,
}));

vi.mock('../../src/api/client', () => ({ sdk: {} }));

const { Route } = await import('../../src/routes/auth/callback');
const Component = (Route as unknown as { component: () => ReactNode }).component;

describe('/auth/callback once signed in', () => {
    it('keeps the query on a path it returns to, such as an app waiting for approval', () => {
        state.search = { redirect: '/oauth/authorize?client_id=dyn_1&state=abc' };
        render(<Component />);
        expect(navigate).toHaveBeenLastCalledWith({ href: '/oauth/authorize?client_id=dyn_1&state=abc', replace: true });
    });

    it('goes to the path the sign-in started from', () => {
        state.search = { redirect: '/settings/security' };
        render(<Component />);
        expect(navigate).toHaveBeenLastCalledWith({ href: '/settings/security', replace: true });
    });

    it('goes home for a return address that would leave the console', () => {
        state.search = { redirect: '//evil.example/' };
        render(<Component />);
        expect(navigate).toHaveBeenLastCalledWith({ href: '/', replace: true });
    });

    it('goes home when no return address came back', () => {
        state.search = {};
        render(<Component />);
        expect(navigate).toHaveBeenLastCalledWith({ href: '/', replace: true });
    });
});
