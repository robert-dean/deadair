/**
 * Paths reachable without a session. Everything else is gated.
 *
 * `/auth/callback` is where a magic link and a finished federated sign-in both land, and by
 * definition nobody arriving there has a session yet — that is what they are there to get. Without
 * it the gate would bounce every link to `/login` before the loader could redeem it, spending
 * nothing and explaining nothing.
 */
export const PUBLIC_PATHS: readonly string[] = ['/login', '/onboarding', '/auth/callback'];

/**
 * Where an auth-aware navigation should land, or undefined to stay put.
 * Anonymous visitors are pushed to the login page; authenticated ones are pulled off it.
 */
export function resolveAuthRedirect(pathname: string, isAuthenticated: boolean): '/login' | '/' | undefined {
    if (!isAuthenticated) {
        return PUBLIC_PATHS.includes(pathname) ? undefined : '/login';
    }
    return pathname === '/login' ? '/' : undefined;
}
