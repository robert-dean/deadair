import { createFileRoute, Navigate } from '@tanstack/react-router';

import { SettingsIndex } from '../../components/settings/settings.index';
import { SettingsShell } from '../../components/settings/settings.shell';
import { usePhone } from '../../components/shared/use.phone';

export const Route = createFileRoute('/settings/')({ component: SettingsIndexRoute });

/**
 * What `/settings` with nothing after it means, which is not the same thing on a phone as on a desk.
 *
 * On a desk the rail already lists every section beside the page, so a landing page listing them
 * again would be the same thing said twice and two URLs an operator could be told they are at. It
 * goes straight to Station, which is the first section and the one somebody setting a station up
 * needs first.
 *
 * On a phone the rail is collapsed and there is nothing else: the bottom bar holds four destinations
 * by design and the kebab holds one flat Settings item. So this is the front door, and it lists the
 * sections with the sentence saying what each one holds.
 *
 * ## Why a hook rather than a redirect in `beforeLoad`
 *
 * `beforeLoad` runs once, before there is a component, so a viewport read there is a media query
 * answered at navigation time and never again — turning a phone sideways, or a desktop window
 * dragged narrow, would leave the wrong answer standing. {@link usePhone} is a subscription, so the
 * page follows the viewport. It costs the redirect being a render rather than a navigation, which
 * `replace` keeps out of the history either way.
 */
function SettingsIndexRoute() {
    const phone = usePhone();

    // `replace`, so the back button steps to wherever the operator came FROM rather than to a
    // `/settings` that would immediately send them here again.
    if (!phone) return <Navigate to="/settings/station" replace />;

    return (
        // No `active`: this is the list of sections rather than one of them, and saying otherwise
        // would draw a way back to the page the operator is already on.
        <SettingsShell>
            <SettingsIndex />
        </SettingsShell>
    );
}
