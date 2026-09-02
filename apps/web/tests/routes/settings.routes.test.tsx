// `/settings` stopped being a page when each section became one, and what is pinned here is that it
// still goes somewhere. Every link that already pointed at it — the sidebar footer, the phone menu,
// every attention row whose destination is Settings rather than any part of it — kept working
// because of this redirect, so a change that drops it breaks them all at once and silently.

import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_ROUTES, SETTINGS_SECTIONS } from '../../src/components/settings/settings.shell';

// Curried like the real thing — `createFileRoute(path)(options)` — handing the options back so the
// redirect can be read without standing up the generated route tree. The sibling `plugins.routes`
// suite does the same.
vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => options,
    redirect: (options: unknown) => ({ isRedirect: true, ...(options as object) }),
}));

const { Route: IndexRoute } = await import('../../src/routes/settings/index');

type GuardedRoute = { beforeLoad: () => void };

describe('/settings', () => {
    it('sends a bare /settings to the first section rather than drawing a page', () => {
        // Thrown rather than returned, which is how the router is told to abandon this match.
        expect(() => (IndexRoute as unknown as GuardedRoute).beforeLoad()).toThrow(
            expect.objectContaining({ isRedirect: true, to: '/settings/station' }),
        );
    });

    it('redirects somewhere that is actually a section', () => {
        // A redirect to a path no route serves is a 404 reachable from the sidebar, which is worse
        // than the long page this replaced.
        let thrown: unknown;
        try {
            (IndexRoute as unknown as GuardedRoute).beforeLoad();
        } catch (caught) {
            thrown = caught;
        }

        const to = (thrown as { to: string }).to;
        expect(Object.values(SETTINGS_ROUTES)).toContain(to);
    });
});

describe('the section list', () => {
    it('gives every section a route, and every route a section', () => {
        // `SETTINGS_ROUTES` is a `Record` over the id union, so a missing entry cannot compile. What
        // it cannot catch is a route in the table that no section names, which would be a page an
        // operator can reach and the nav never offers.
        expect(Object.keys(SETTINGS_ROUTES).sort()).toEqual(SETTINGS_SECTIONS.map(section => section.id).sort());
    });

    it('keeps Plugins where it already was', () => {
        // It was a route long before the others were, and its URL is one an operator may have
        // bookmarked. Moving it under `/settings` would have been a rename nobody asked for.
        expect(SETTINGS_ROUTES.plugins).toBe('/plugins');
    });
});
