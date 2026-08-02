import { useSyncExternalStore } from 'react';

/** The access token the SPA holds in memory. Never persisted: the refresh cookie is the durable half. */
export interface SessionSnapshot {
    /** Undefined while anonymous. */
    accessToken?: string;
    /** Epoch milliseconds at which `accessToken` stops being usable. Undefined while anonymous. */
    expiresAt?: number;
}

const ANONYMOUS: SessionSnapshot = {};

let snapshot: SessionSnapshot = ANONYMOUS;
let epoch = 0;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

/** Stores a freshly issued token. `expiresIn` is the OAuth lifetime in seconds. */
export function setSession(accessToken: string, expiresIn: number): void {
    snapshot = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    // Gaining a session is as much a "something changed" signal as losing one, so it bumps the epoch
    // too. A sign-in hands the browser a brand new refresh cookie, which retires whatever verdict the
    // bootstrap reached about the old one: without this, a `rejected` cached while the tab was still
    // anonymous outlives the login and, once the access token expires, answers for a cookie it never
    // saw. Bumping here rather than calling into the bootstrap keeps that dependency pointing one way
    // (the store stays free of anything that imports the API client), and the bootstrap already
    // re-reads the epoch when an attempt settles, so a redeem's own success cannot re-arm the very
    // attempt that produced it.
    epoch += 1;
    emit();
}

/** Drops the in-memory token. Does not touch the refresh cookie. */
export function clearSession(): void {
    if (snapshot === ANONYMOUS) {
        return;
    }
    snapshot = ANONYMOUS;
    // A live session losing its token is the "something changed" signal the bootstrap watches for,
    // so it knows to try the refresh cookie again instead of replaying its cached answer.
    epoch += 1;
    emit();
}

export function getSession(): SessionSnapshot {
    return snapshot;
}

/**
 * How many times the session has changed hands: bumped by `setSession()` and `clearSession()` alike,
 * so callers can cache work against a session without importing anything that imports the API client.
 */
export function sessionEpoch(): number {
    return epoch;
}

/**
 * Whether a snapshot represents a usable session. An expired token counts as anonymous: it cannot
 * authorise anything, and saying so is what sends the caller back to the refresh cookie.
 * Pure, so components may call it during render.
 */
export function isSessionActive(session: SessionSnapshot): boolean {
    if (!session.accessToken) {
        return false;
    }
    return session.expiresAt === undefined || session.expiresAt > Date.now();
}

export function isAuthenticated(): boolean {
    return isSessionActive(snapshot);
}

/** Authorization header for the SDK fetch. Empty while anonymous so no bogus header is sent. */
export function authHeaders(): Record<string, string> {
    return isAuthenticated() ? { Authorization: `Bearer ${snapshot.accessToken}` } : {};
}

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getSnapshot(): SessionSnapshot {
    return snapshot;
}

/** React binding over the module-level store. */
export function useSession(): SessionSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
