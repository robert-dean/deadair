import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './en/en.catalog';

/** The locales built into the console. The first is the source language and the fallback; the rest arrive as packs. */
export const SUPPORTED_LOCALES = ['en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The first of the browser's preferred languages the console can speak, matched on the primary
 * subtag (`en-GB` is `en`), or the source language when none of them is.
 */
export function pickLocale(preferred: readonly string[]): SupportedLocale {
    for (const tag of preferred) {
        const primary = tag.toLowerCase().split('-')[0];
        const match = SUPPORTED_LOCALES.find(locale => locale === primary);
        if (match) return match;
    }
    return SUPPORTED_LOCALES[0];
}

// Initialised synchronously, at import, from a bundled catalog: the first render already has its
// words, so there is no frame of keys and no Suspense boundary to put around the whole console.
// Any other language arrives later as a language pack (`languages.ts`), and English stays bundled
// because it is the fallback for any key that language has not got.
void i18n.use(initReactI18next).init({
    resources: { en },
    lng: pickLocale(typeof navigator === 'undefined' ? [] : navigator.languages),
    fallbackLng: SUPPORTED_LOCALES[0],
    // No `supportedLngs`: it would refuse every language a pack installs after start-up. Which
    // languages exist is `languages.ts`'s list, and `showLanguage` only ever asks for one on it.
    defaultNS: 'common',
    ns: Object.keys(en),
    initAsync: false,
    // React escapes what it renders; escaping here as well would show `&amp;` to an operator.
    interpolation: { escapeValue: false },
    // The keys are typed, so a missing one is a stale catalog rather than a typo. Say so in dev.
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- Vite's build mode, not a process variable.
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (locales, namespace, key) => console.warn(`[i18n] missing ${namespace}:${key} for ${locales.join(', ')}`),
});

// Screen readers and the browser's own hyphenation and spellcheck read `lang`, so it follows the
// language the console is actually showing rather than the one `index.html` was written in.
function applyLang(locale: string): void {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
applyLang(i18n.resolvedLanguage ?? SUPPORTED_LOCALES[0]);
i18n.on('languageChanged', applyLang);

export { i18n };
