/**
 * A fresh `X-Request-ID`, in the shape `crypto.randomUUID()` answers with: a version-4 UUID.
 *
 * Not `crypto.randomUUID()` itself, which is what the SDK reaches for when it is handed nothing, and
 * that is the whole reason this exists. The browser only defines it in a SECURE context, meaning HTTPS
 * or localhost, and a station on a home network is opened at `http://<the server's address>:8080`,
 * which is neither. There it is undefined, so every request the console made threw a `TypeError`
 * before it reached the network, and the console called that "Can't reach the station" (issue #78).
 * `getRandomValues` is the one part of Web Crypto a plain-HTTP page keeps, so the UUID is assembled
 * from it by hand rather than preferring `randomUUID` where it happens to exist: one path, and it is
 * the path every station takes.
 */
export function newRequestId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // RFC 9562 §5.4: the high nibble of byte 6 is the version, the top two bits of byte 8 the variant.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
