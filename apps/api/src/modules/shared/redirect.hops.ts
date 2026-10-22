/**
 * Following redirects by hand, so every hop can be looked at before it is connected to.
 *
 * Three services fetch from an address somebody else chose: upstream art, a record's audio and a
 * podcast episode. A `redirect: 'follow'` fetch connects to wherever a `location` says before any of
 * them could object, and a public host can bounce it onto `127.0.0.1` or the analysis sidecar. So each
 * follows the chain itself, and this is the chain: the hop check runs before each connection, the
 * abandoned hop's body is cancelled so its socket goes, and the count stops a loop.
 *
 * What is NOT here is the policy, because the three disagree about it on purpose. Which hops are
 * checked (track audio trusts its first address, which its resolver chose), which hosts are exempt
 * (art trusts the operator's own servers), and what a refusal says (a podcast's is shown in the
 * console) all stay with the caller, passed in as {@link RedirectHops.beforeHop} and
 * {@link RedirectHops.next}. The plugin host's own fetch follows a richer set of rules (method
 * rewriting, dropping credentials across origins) and shares only {@link REDIRECT_STATUSES}.
 */

/** The statuses that carry a `location` to follow. */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** How one chain is followed. */
export interface RedirectHops {
    fetch: typeof globalThis.fetch;
    /** What every hop's request carries. `redirect` is always `manual`, which is the point. */
    init?: Omit<RequestInit, 'redirect'>;
    /** How many redirects to follow before giving up; the chain makes at most one request more than this. */
    maxRedirects: number;
    /**
     * Called before EVERY hop is connected to, the first included, and throws to refuse it. `from` is
     * the hop that sent the fetch here, `undefined` for the first, so a caller that trusts its first
     * address can say so.
     */
    beforeHop: (address: URL, from: URL | undefined) => Promise<void>;
    /** A redirect's `location`, resolved against the hop that sent it. Throws to refuse it (a `file:` address, say). */
    next: (location: string, from: URL) => URL;
    /** The error for a chain longer than {@link maxRedirects}. */
    tooMany: () => Error;
}

/**
 * The response at the end of a redirect chain, whatever its status.
 *
 * A redirect status with no `location` is an answer rather than a hop, and comes back like any other
 * for the caller to refuse. The caller owns the body of what comes back.
 */
export async function followRedirects(first: URL, hops: RedirectHops): Promise<Response> {
    let address = first;
    let from: URL | undefined;

    for (let hop = 0; hop <= hops.maxRedirects; hop += 1) {
        await hops.beforeHop(address, from);

        const response = await hops.fetch(address, { ...hops.init, redirect: 'manual' });

        const location = response.headers.get('location');
        if (!REDIRECT_STATUSES.has(response.status) || location === null) return response;

        // Left behind either way, so let its socket go rather than leave it to the collector.
        await response.body?.cancel().catch(() => undefined);
        from = address;
        address = hops.next(location, address);
    }

    throw hops.tooMany();
}
