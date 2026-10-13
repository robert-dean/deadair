import { useSyncExternalStore } from 'react';

/**
 * How this browser reads a time of day.
 *
 * `auto` is what the console did before there was a choice, and it is not one rule: the on-air
 * screens keep the 24-hour clock the station runs on, the feeds keep 12-hour stamps, and everything
 * else follows the locale. `12` and `24` override all three, for an operator who reads one clock and
 * wants it everywhere.
 */
export type ClockChoice = 'auto' | '12' | '24';

export const CLOCK_CHOICES: readonly ClockChoice[] = ['auto', '12', '24'];

/** Where the choice is kept. */
export const CLOCK_STORAGE_KEY = 'da-clock';

function isClockChoice(value: unknown): value is ClockChoice {
    return value === 'auto' || value === '12' || value === '24';
}

let current: ClockChoice = read();
const listeners = new Set<() => void>();

/** The stored choice, or `auto`. An unreadable `localStorage` is the same as no choice, as it is for the theme. */
function read(): ClockChoice {
    try {
        const stored = window.localStorage.getItem(CLOCK_STORAGE_KEY);
        if (isClockChoice(stored)) return stored;
    } catch {
        // Site data is blocked.
    }
    return 'auto';
}

/** Chooses a clock, for this browser and this browser only. */
export function setClock(choice: ClockChoice): void {
    if (choice === current) return;
    current = choice;
    try {
        window.localStorage.setItem(CLOCK_STORAGE_KEY, choice);
    } catch {
        // Remembering is a courtesy.
    }
    for (const listener of listeners) listener();
}

export function getClock(): ClockChoice {
    return current;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * React binding over the module-level store.
 *
 * The formatters read {@link getClock} directly, so a component needs this only to redraw the moment
 * the choice changes. The picker holds it; every other screen takes the new clock the next time it
 * renders, which for the station clock in the header is within the second.
 */
export function useClock(): ClockChoice {
    return useSyncExternalStore(subscribe, getClock, getClock);
}
