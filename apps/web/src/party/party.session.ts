import type { DateTime } from 'luxon';

/**
 * The guest's way in, kept in this browser so a reload is the same guest with the same one request at
 * a time, rather than a new guest every time the page is opened.
 *
 * `localStorage` and not a cookie: the session is a bearer the page sends itself, and nothing here
 * should ride along on a request the page did not make. Every read and write is guarded, because a
 * private window or blocked site data throws, and the page has to work without it: a guest then joins
 * afresh on each load, which costs them only their place in the one-at-a-time rule.
 */
export const GUEST_STORAGE_KEY = 'da-party-guest';

export interface StoredGuest {
    /** The party's pass this session came from, so a new party's code is not answered with an old session. */
    pass: string;
    accessToken: string;
    /** ISO-8601. */
    expiresAt: string;
}

/** The pass in the page's address, after `#`, or undefined when there is none. */
export function passFromHash(hash: string): string | undefined {
    const pass = decodeURIComponent(hash.replace(/^#/, '')).trim();
    return pass.length > 0 && pass.length <= 200 ? pass : undefined;
}

/**
 * The stored session to carry on with: one still within its time, and from this pass when the page was
 * opened with one. Opened with no pass at all (a reload after the address was tidied), any live one.
 */
export function usableGuest(stored: StoredGuest | undefined, pass: string | undefined, now: Date): StoredGuest | undefined {
    if (stored === undefined) return undefined;
    if (pass !== undefined && stored.pass !== pass) return undefined;
    return Date.parse(stored.expiresAt) > now.getTime() ? stored : undefined;
}

export function loadGuest(): StoredGuest | undefined {
    try {
        const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
        if (raw === null) return undefined;
        const parsed = JSON.parse(raw) as Partial<StoredGuest>;
        return typeof parsed.pass === 'string' && typeof parsed.accessToken === 'string' && typeof parsed.expiresAt === 'string'
            ? { pass: parsed.pass, accessToken: parsed.accessToken, expiresAt: parsed.expiresAt }
            : undefined;
    } catch {
        return undefined;
    }
}

export function saveGuest(pass: string, session: { accessToken: string; expiresAt: DateTime }): StoredGuest {
    const guest = { pass, accessToken: session.accessToken, expiresAt: session.expiresAt.toUTC().toISO() ?? '' };
    try {
        window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
    } catch {
        // Site data is blocked: this load still works, and the next one joins again.
    }
    return guest;
}

export function forgetGuest(): void {
    try {
        window.localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
        // Nothing to forget.
    }
}
