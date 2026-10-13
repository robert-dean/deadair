/**
 * The invitation's token, from after `#` in the address: the one part of a URL no server sees, no log
 * records and no Referer carries. Anything empty or longer than a token can be is no token.
 */
export function tokenFromHash(hash: string): string | undefined {
    let token: string;
    try {
        token = decodeURIComponent(hash.replace(/^#/, '')).trim();
    } catch {
        return undefined;
    }
    return token.length > 0 && token.length <= 200 ? token : undefined;
}
