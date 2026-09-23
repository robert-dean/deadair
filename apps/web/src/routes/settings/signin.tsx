import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Where "Sign-in and connections" used to be, before it became the second half of Sign-in and
 * security. Kept as a redirect because the address was a page for a release and more, so it is in
 * bookmarks and old links, and following one should land on the page rather than on nothing.
 */
export const Route = createFileRoute('/settings/signin')({
    beforeLoad: () => {
        throw redirect({ to: '/settings/security', replace: true });
    },
});
