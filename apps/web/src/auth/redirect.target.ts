/**
 * Narrows a `?redirect=` value to a same-origin app path, falling back to `/`.
 * Anything that could leave the origin (absolute URL, protocol-relative `//host`,
 * or the `/\host` variant some browsers normalise to one) is rejected.
 */
export function safeRedirectTarget(value: string | undefined): string {
    if (!value || !value.startsWith('/')) {
        return '/';
    }
    if (value.startsWith('//') || value.startsWith('/\\')) {
        return '/';
    }
    return value;
}
