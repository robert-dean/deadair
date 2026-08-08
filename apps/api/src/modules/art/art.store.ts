import { ContentStore } from '#modules/shared/content.store.js';

/**
 * The formats art is stored in, and what each is served AS.
 *
 * Deliberately not the inverse of {@link ART_CONTENT_TYPES}, which is what an upstream may CALL an
 * image on the way in and is generous on purpose: `image/jpg` is not a registered type but plenty
 * of servers send it. This is what we say on the way out, so there is exactly one mime per format
 * and it is the correct one.
 *
 * Has to stay in step with the mimes `art.ck` declares on the 200: the service answers with one of
 * these and the router sets `ctx.type` from it, so a format here the contract does not declare will
 * not type-check.
 */
export const ART_SERVED_TYPES = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
} as const satisfies Record<string, string>;

export type ArtExtension = keyof typeof ART_SERVED_TYPES;

export type ArtContentType = (typeof ART_SERVED_TYPES)[ArtExtension];

/** Filename extensions the store will write or read. Anything else is not art we serve. */
export const ART_EXTENSIONS = Object.keys(ART_SERVED_TYPES) as readonly ArtExtension[];

/** Response content types the cacher accepts, mapped to the extension the file gets on disk. */
export const ART_CONTENT_TYPES: Record<string, ArtExtension> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

export function isArtExtension(value: string | undefined): value is ArtExtension {
    return value !== undefined && Object.hasOwn(ART_SERVED_TYPES, value);
}

/**
 * Cached artwork on disk.
 *
 * Everything about how bytes are laid out, and every guard against a path that is not what it
 * claims, is {@link ContentStore}'s; this is which formats and a name injectkit can register
 * against.
 */
export class ArtStore extends ContentStore<ArtExtension> {
    constructor(root: string) {
        super(root, ART_SERVED_TYPES);
    }
}
