/** Paths reachable without a session. Everything else is gated. */
export const PUBLIC_PATHS: readonly string[] = ['/login', '/onboarding'];

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
