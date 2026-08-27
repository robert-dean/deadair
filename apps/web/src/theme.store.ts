import { useSyncExternalStore } from 'react';

import { DEFAULT_THEME, isThemeId, THEMES, type ThemeDefinition, type ThemeId } from './themes';

/** Where the choice is kept, and the name the inline script in `index.html` reads it by. */
export const THEME_STORAGE_KEY = 'da-theme';

/** The attribute `tokens.css` keys its `--da-*` blocks on. Written here and nowhere else. */
const THEME_ATTRIBUTE = 'data-da-theme';

let current: ThemeId = read();
const listeners = new Set<() => void>();

/**
 * The stored choice, or the default.
 *
 * Wrapped in a try because `localStorage` throws rather than returning nothing in a browser with
 * site data blocked, and a console that will not render at all because it could not remember a
 * colour is the wrong trade. An unreadable preference is the same as no preference.
 */
function read(): ThemeId {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (isThemeId(stored)) return stored;
    } catch {
        // Site data is blocked. Carbon it is.
    }
    return DEFAULT_THEME;
}

/**
 * Chooses a theme, for this browser and this browser only.
 *
 * The attribute is written here rather than in a `useEffect` so that the stylesheet and the Mantine
 * provider change in the same tick. Split across a render and an effect, the console paints one
 * frame with the new theme's variables under the old theme's tuples, which reads as a flash of a
 * theme nobody chose.
 */
export function setTheme(id: ThemeId): void {
    if (id === current) return;
    current = id;
    document.documentElement.setAttribute(THEME_ATTRIBUTE, id);
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
        // Remembering is a courtesy; not remembering is not a failure worth telling anybody about.
    }
    for (const listener of listeners) listener();
}

export function getTheme(): ThemeId {
    return current;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** React binding over the module-level store, the same shape `auth/session.store.ts` uses. */
export function useThemeId(): ThemeId {
    return useSyncExternalStore(subscribe, getTheme, getTheme);
}

/** The whole definition of whatever is on, which is what the provider and the swatches both want. */
export function useTheme(): ThemeDefinition {
    return THEMES[useThemeId()];
}
