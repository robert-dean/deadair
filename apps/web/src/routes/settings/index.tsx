import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/settings` is not a page any more, so it sends the operator to the first section.
 *
 * A redirect rather than a tenth section drawn here, because two URLs rendering the same thing is
 * two places an operator can be told they are, and the nav could only light one of them.
 *
 * It exists at all for the links that already point here and should keep working: the sidebar
 * footer, the phone menu, and every attention row whose destination is the settings page rather
 * than any particular part of it. Station is the first section and the one an operator setting a
 * station up needs first, so it is where "settings" with nothing further means.
 */
export const Route = createFileRoute('/settings/')({
    beforeLoad: () => {
        throw redirect({ to: '/settings/station' });
    },
});
