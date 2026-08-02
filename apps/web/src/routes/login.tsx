import { createFileRoute } from '@tanstack/react-router';

import { LoginPage } from '../components/login.page';

export interface LoginSearch {
    /** Where to land after a successful sign-in. Sanitised by the page before it is followed. */
    redirect?: string;
}

function LoginRoute() {
    const { redirect } = Route.useSearch();
    return <LoginPage redirect={redirect} />;
}

export const Route = createFileRoute('/login')({
    validateSearch: (search: Record<string, unknown>): LoginSearch => ({
        redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    }),
    component: LoginRoute,
});
