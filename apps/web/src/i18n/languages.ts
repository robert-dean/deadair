import { useSyncExternalStore } from 'react';

import { en } from './en/en.catalog';
import { registerDayjsLocale } from './dayjs.locale';
import { i18n } from './i18n.setup';
import { checkLanguagePack, type LanguagePackCheck } from './language.check';

/** A language the console can be shown in, as the picker lists it. */
export interface ConsoleLanguage {
    /** Its BCP 47 tag, canonical: `de`, `pt-BR`. */
    locale: string;
    /** Its name in itself: `Deutsch`. */
    name: string;
    direction: 'ltr' | 'rtl';
}

/** Built in, and what every other language falls back to key by key. */
export const ENGLISH: ConsoleLanguage = { locale: 'en', name: 'English', direction: 'ltr' };

/**
 * The languages this console holds right now: English, and whatever packs have been installed since
 * it loaded. A module-level store rather than React state, because i18next's instance is one too and
 * the two have to agree about what exists.
 */
let languages: readonly ConsoleLanguage[] = [ENGLISH];
const listeners = new Set<() => void>();

function publish(next: readonly ConsoleLanguage[]): void {
    languages = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Every language this console can be shown in, English first. */
export function availableLanguages(): readonly ConsoleLanguage[] {
    return languages;
}

/** The languages, for a component that redraws when one is installed or removed. */
export function useAvailableLanguages(): readonly ConsoleLanguage[] {
    return useSyncExternalStore(subscribe, availableLanguages);
}

/** The language on screen, falling back to English for a tag nothing installed. */
export function currentLanguage(): ConsoleLanguage {
    const locale = i18n.resolvedLanguage ?? ENGLISH.locale;
    return languages.find(language => language.locale === locale) ?? ENGLISH;
}

function subscribeToLanguage(listener: () => void): () => void {
    i18n.on('languageChanged', listener);
    const unsubscribe = subscribe(listener);
    return () => {
        i18n.off('languageChanged', listener);
        unsubscribe();
    };
}

/** Which way the text on screen runs, for the provider that turns the layout round. */
export function useConsoleDirection(): 'ltr' | 'rtl' {
    return useSyncExternalStore(subscribeToLanguage, () => currentLanguage().direction);
}

/**
 * Reads a language pack and, if this console can use it, installs it.
 *
 * Installing makes the language available and loads its strings, and changes nothing on screen:
 * which language is shown is `showLanguage`'s business. What the pack could not supply (a key it
 * lacks, a string it got wrong) falls back to English one string at a time, which is i18next's own
 * behaviour with English as `fallbackLng`. The check is returned either way, so whoever installed
 * it can say what came of it.
 *
 * Installing a language that is already here replaces its strings wholesale, not key by key: a key
 * the new pack dropped must fall back to English, not keep the old translation.
 */
export function installLanguagePack(file: unknown): LanguagePackCheck {
    const check = checkLanguagePack(file, en);
    if (!check.ok) return check;

    for (const namespace of Object.keys(en)) {
        i18n.removeResourceBundle(check.locale, namespace);
        const strings = check.catalog[namespace];
        if (typeof strings === 'object') i18n.addResourceBundle(check.locale, namespace, strings, true, true);
    }
    registerDayjsLocale(check.locale);

    const language: ConsoleLanguage = { locale: check.locale, name: check.name, direction: check.direction };
    publish([...languages.filter(existing => existing.locale !== check.locale), language]);
    return check;
}

/**
 * Takes a language away again. The console goes back to English first if it was showing it, since a
 * language with no strings would show English anyway and say it was something else.
 */
export async function removeLanguage(locale: string): Promise<void> {
    if (locale === ENGLISH.locale) return;
    if (i18n.resolvedLanguage === locale) await showLanguage(ENGLISH.locale);
    for (const namespace of Object.keys(en)) i18n.removeResourceBundle(locale, namespace);
    publish(languages.filter(language => language.locale !== locale));
}

/** Shows the console in `locale`, which must be installed; anything else shows English. */
export async function showLanguage(locale: string): Promise<void> {
    const target = languages.some(language => language.locale === locale) ? locale : ENGLISH.locale;
    await i18n.changeLanguage(target);
}

// The page's own direction follows the language on screen, for the browser's text handling and for
// Mantine's styles that read `dir` from the root. `lang` is kept by `i18n.setup.ts`.
function applyDirection(): void {
    if (typeof document !== 'undefined') document.documentElement.dir = currentLanguage().direction;
}
applyDirection();
i18n.on('languageChanged', applyDirection);
