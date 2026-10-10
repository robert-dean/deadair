import { BASE_URL } from './client';

/**
 * The `src` for an `imageUrl` off the catalog.
 *
 * The API reports a path relative to its own root: `art/<uuid>` once the station holds its own
 * copy, or `art/source/<token>` for a cover it fetches on first ask. Never a provider's URL, which
 * can carry a credential; an absolute URL is still passed through, for an older station. The API
 * mounts its routers at the root and knows nothing about the `/api` prefix the edge adds, so
 * resolving the relative form is the client's job.
 *
 * Undefined in, undefined out, so a caller can hand it a row's field without checking first.
 */
export const artSrc = (imageUrl: string | undefined): string | undefined => {
    if (imageUrl === undefined || imageUrl === '') return undefined;
    if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

    return `${BASE_URL}/${imageUrl.replace(/^\/+/, '')}`;
};
