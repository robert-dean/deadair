import type { LinkProps } from '@tanstack/react-router';

export interface AttentionDestination {
    to: LinkProps['to'];
    params?: Record<string, string>;
    /** The tab, for a destination that has them. */
    search?: Record<string, string>;
    /** Where this goes, named as the nav names it. */
    label: string;
}

/**
 * A path the station sent, as a place this console actually has.
 *
 * ## Why the console translates at all
 *
 * The station names the page it thinks can fix a thing — `/personas`, `/onair` — and those were
 * pages when it learned the names. They are tabs on destinations now. Rather than teach the API the
 * console's navigation, which would make every future regrouping a schema change, the mapping lives
 * here and the API keeps saying what it means.
 *
 * ## One table, two readers
 *
 * `attention.list.tsx` draws the link on the row and `side.nav.tsx` counts the badge on the nav.
 * They were separate before and could disagree about where a fault belonged; a badge pointing at
 * one page while the row linked to another is worse than either alone. Both read this now.
 *
 * ## An unknown route draws no link rather than a broken one
 *
 * The router's `to` is typed against the registered routes, which is what stops a link pointing at
 * a page that does not exist — the failure this console has already had once. A path from the API
 * is a string, so anything not matched here keeps its sentence and loses its link.
 */
export function attentionDestinationOf(route: string): AttentionDestination | undefined {
    const plugin = /^\/plugins\/(.+)$/.exec(route);
    if (plugin?.[1]) return { to: '/plugins/$id', params: { id: plugin[1] }, label: 'Plugin' };

    switch (route) {
        // The station still names `/onair` for anything about the broadcast. The desk is where that
        // is answered now, and it is also where this list is drawn — so the row points at the
        // running order further down the same page.
        case '/onair':
            return { to: '/', label: 'Desk' };
        // A persona is a tab on Voice rather than a page. The row lands on the tab that holds it,
        // not on the destination's default, because an operator sent here has a specific complaint.
        case '/personas':
            return { to: '/voice', search: { tab: 'characters' }, label: 'Voice' };
        case '/schedule':
            return { to: '/schedule', label: 'Schedule' };
        case '/catalog':
            return { to: '/catalog', label: 'Catalog' };
        case '/plugins':
            return { to: '/plugins', label: 'Plugins' };
        case '/settings':
            return { to: '/settings', label: 'Settings' };
        default:
            return undefined;
    }
}

/**
 * Which NAV entry a thing counts against, as the string `NavItem.to` carries.
 *
 * Derived from the same table rather than restated, so a route that moves moves once. A row whose
 * destination this console does not have is counted nowhere — it is still on the desk, which is the
 * surface that has to be complete.
 */
export function attentionNavPageOf(route: string): string | undefined {
    const destination = attentionDestinationOf(route);
    if (!destination) return undefined;
    // A plugin's own page counts against Plugins in the nav: the nav has no entry per plugin, and
    // the first segment is what the link list is keyed on.
    return destination.to === '/plugins/$id' ? '/plugins' : (destination.to as string);
}
