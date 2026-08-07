import { BASE_URL } from './client';

/**
 * The `src` for an `imageUrl` off the catalog.
 *
 * The API reports one of two things in that field: an absolute URL at the provider's own CDN, for
 * art nothing has cached yet, or a path relative to the API root (`art/<uuid>`) once the station
 * holds its own copy. The API mounts its routers at the root and knows nothing about the `/api`
 * prefix the edge adds, so resolving the relative form is the client's job.
 *
 * Undefined in, undefined out, so a caller can hand it a row's field without checking first.
 */
export const artSrc = (imageUrl: string | undefined): string | undefined => {
    if (imageUrl === undefined || imageUrl === '') return undefined;
    if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

    return `${BASE_URL}/${imageUrl.replace(/^\/+/, '')}`;
};
