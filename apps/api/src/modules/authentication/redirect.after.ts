/**
 * A place on the console to return somebody to after they sign in, narrowed to a same-origin path.
 *
 * The server-side twin of `apps/web/src/auth/redirect.target.ts`, and the same rules: it must start
 * with `/`, and must not start with `//` or `/\`, which browsers read as another host. Anything else
 * is `undefined`, and the console opens at its home page.
 *
 * It exists because the value crosses an identity provider and back, held in the sign-in's state,
 * and the callback used to treat it as a whole URL: whatever reached it became the page the browser
 * was sent to next, which is an open redirect waiting for the first route to pass one through. So
 * it is a path, checked when the sign-in starts and again when it ends, and the browser always
 * lands on the console's own callback page with that path beside it.
 */
export function safeRedirectPath(value: string | undefined): string | undefined {
    if (value === undefined || !value.startsWith('/')) return undefined;
    if (value.startsWith('//') || value.startsWith('/\\')) return undefined;
    return value;
}
