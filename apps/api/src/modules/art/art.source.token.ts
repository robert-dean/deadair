import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * A provider's cover URL, sealed so the station can hand out a path to it without handing out the URL.
 *
 * ## Why a cover needs this at all
 *
 * A cover the station has cached is served from its own store at `art/<id>`. One it has not cached
 * yet used to be reported as the provider's own URL, and some of those carry a credential: a
 * Subsonic `getCoverArt` link holds the operator's user and token, which the server accepts on every
 * endpoint. The sweep caches about fifty covers every ten minutes, so "show nothing until it is
 * cached" leaves a fresh library blank for hours. So every read reports an uncached cover as
 * `art/source/<token>` instead, and `GET /art/source/{token}` fetches it into the store on first ask
 * and serves the station's copy. The URL never leaves the server.
 *
 * ## What the token is
 *
 * AES-256-GCM over the URL with a SYNTHETIC IV: the first twelve bytes of an HMAC-SHA256 of the URL.
 * Deterministic on purpose, so one cover is one token and a browser's cache, the conditional-GET
 * ETag and the single-flight in `ArtSourceService` all key on something stable. Determinism costs
 * only that two equal URLs are recognisably equal, which says nothing about either. Opening checks
 * the GCM tag AND recomputes the synthetic IV from the plaintext, so a token is accepted only if this
 * station minted it for exactly that URL; anything else, forged or truncated or from a different
 * key, opens to nothing and the route answers 404.
 *
 * ## Where the key comes from
 *
 * `KMS_LOCAL_ROOT_KEY`, which every station has and must keep (the server will not start without
 * it), run through HKDF with a label of its own, so this key is not the key anything is encrypted
 * with and cannot be used to open anything else. The bridge secret was the other candidate and is
 * the wrong one: it can be unseeded or rotated, and a rotation would break every cover URL a page
 * already holds. Rotating the root key does break them, which is the same cost it has everywhere.
 *
 * ## Why module state
 *
 * The readers that need it are SQL row mappers in five repositories and the director's console read,
 * none of which has a reason to take a crypto dependency through its constructor, and a missing
 * argument in one of them would be a provider URL in a response rather than a compile error. So the
 * key is configured once at boot by `ArtModule` (`configureArtSourceKey`), the way the log store is
 * published by `setLogStore`, and {@link stationCover} is a plain function. Unconfigured, it answers
 * nothing for an upstream URL rather than the URL: failing closed costs a cover, never a credential.
 */

const LABEL = 'deadair art source token v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface SourceKeys {
    encrypt: Buffer;
    mac: Buffer;
}

let keys: SourceKeys | undefined;

/** Derive this purpose's keys from the station's root key (hex). Called once by `ArtModule`; tests call it too. */
export function configureArtSourceKey(rootKeyHex: string): void {
    const root = Buffer.from(rootKeyHex.trim(), 'hex');
    if (root.length === 0) {
        keys = undefined;
        return;
    }
    const derived = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), LABEL, 64));
    keys = { encrypt: derived.subarray(0, 32), mac: derived.subarray(32, 64) };
}

/** Forget the key, so a test can prove the unconfigured path fails closed. */
export function clearArtSourceKey(): void {
    keys = undefined;
}

const syntheticIv = (mac: Buffer, url: string): Buffer => createHmac('sha256', mac).update(url, 'utf8').digest().subarray(0, IV_BYTES);

/** Seal an upstream URL into a URL-safe token, or nothing when no key is configured. */
export function sealSourceUrl(url: string): string | undefined {
    if (keys === undefined) return undefined;
    const iv = syntheticIv(keys.mac, url);
    const cipher = createCipheriv('aes-256-gcm', keys.encrypt, iv);
    const body = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

/** The URL a token was sealed over, or nothing for anything this station did not mint. Never throws. */
export function openSourceToken(token: string): string | undefined {
    if (keys === undefined || !/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) return undefined;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    try {
        const decipher = createDecipheriv('aes-256-gcm', keys.encrypt, iv);
        decipher.setAuthTag(tag);
        const url = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
        // The tag proves the bytes are ours; the IV check proves they were sealed by `sealSourceUrl`
        // for this very URL rather than assembled under some other IV.
        if (!timingSafeEqual(syntheticIv(keys.mac, url), iv)) return undefined;
        return /^https?:\/\//i.test(url) ? url : undefined;
    } catch {
        return undefined;
    }
}

/** The path a sealed upstream cover is served at, under the API root. */
export const sourceArtPath = (token: string): string => `art/source/${token}`;

/**
 * The cover a READ may report, whatever the column held: the station's own `art/` path as it is,
 * an upstream `http(s)` URL as the station's proxy path for it, and nothing for anything else.
 *
 * The one helper every read goes through, so a provider's URL cannot reach a contract field by a
 * mapper forgetting a rule. See the file comment for why it is module state.
 */
export function stationCover(url: string | null | undefined): string | undefined {
    if (url == null) return undefined;
    const value = url.trim();
    if (/^\/?art\//.test(value)) return value;
    if (!/^https?:\/\//i.test(value)) return undefined;
    const token = sealSourceUrl(value);
    return token === undefined ? undefined : sourceArtPath(token);
}

/**
 * {@link stationCover} applied to one field of a row, keeping the row's shape. A cover that maps to
 * nothing becomes `undefined`, which is what an empty column already reads back as at runtime
 * (`apps/api/CLAUDE.md`, "A SQL NULL reads back as `undefined`"), so every mapper downstream treats
 * it exactly as it treated an empty column.
 */
export function withStationCover<T, K extends keyof T>(row: T, field: K): T {
    const value = row[field] as unknown as string | null | undefined;
    return { ...row, [field]: stationCover(value) };
}
