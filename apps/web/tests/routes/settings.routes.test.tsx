// `/settings` is where every link that names Settings without naming a part of it lands: the rail's
// pinned entry, the phone's kebab, and every attention row whose destination is the page rather than
// a section. What it means differs by viewport, and this is what pins both halves — a change that
// drops either one breaks a whole form factor at once and silently.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_ROUTES, SETTINGS_SECTIONS } from '../../src/components/settings/settings.shell';
import { render, screen } from '../utils/render';

// The index route is a component now rather than a `beforeLoad` redirect, so what is under test is
// what it renders: a list on a phone, and a redirect anywhere else. See the note in the route.
let phone = false;

vi.mock('../../src/components/shared/use.phone', () => ({ usePhone: () => phone }));

vi.mock('@tanstack/react-router', () => ({
    createFileRoute: () => (options: unknown) => options,
    Navigate: ({ to, replace }: { to: string; replace?: boolean }) => <div data-testid="redirect" data-to={to} data-replace={String(replace)} />,
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

const { Route: IndexRoute } = await import('../../src/routes/settings/index');

const IndexComponent = (IndexRoute as unknown as { component: () => ReactNode }).component;

afterEach(() => {
    phone = false;
});

describe('/settings', () => {
    it('goes straight to the first section on a desk, where the rail already lists them all', () => {
        render(<IndexComponent />);

        // A landing page listing the sections beside a rail listing the sections is the same thing
        // said twice, and two URLs an operator could be told they are at.
        const redirect = screen.getByTestId('redirect');
        expect(redirect).toHaveAttribute('data-to', '/settings/station');
        // `replace`, so back goes where the operator came FROM rather than to a `/settings` that
        // would send them straight here again.
        expect(redirect).toHaveAttribute('data-replace', 'true');
    });

    it('is the list of sections on a phone, which has no rail to list them', () => {
        phone = true;
        render(<IndexComponent />);

        expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
        for (const section of SETTINGS_SECTIONS) {
            expect(screen.getByRole('link', { name: new RegExp(section.label) })).toBeInTheDocument();
        }
    });

    it('says what each section holds, which is why it is a list and not a menu', () => {
        // "Words" and "Measurement" name subjects rather than settings, so the label alone does not
        // tell an operator looking for the model which one to open.
        phone = true;
        render(<IndexComponent />);

        expect(screen.getByText('Which plugin it asks for words')).toBeInTheDocument();
        expect(screen.getByText('Which plugin measures records')).toBeInTheDocument();
    });

    it('sends each row to that section, Plugins included', () => {
        phone = true;
        render(<IndexComponent />);

        for (const section of SETTINGS_SECTIONS) {
            expect(screen.getByRole('link', { name: new RegExp(section.label) })).toHaveAttribute('href', SETTINGS_ROUTES[section.id]);
        }
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
