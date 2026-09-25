import type { LanguagePack } from '../../src/i18n/language.pack';

/**
 * A small language pack for a test to install: a handful of real keys translated, everything else
 * left to fall back to English, the way a pack half-way through translation arrives.
 */
export function germanPack(overrides: Partial<LanguagePack> = {}): LanguagePack {
    return {
        format: 'deadair.console-language',
        version: 1,
        locale: 'de',
        name: 'Deutsch',
        direction: 'ltr',
        madeFor: '0.0.0',
        catalog: {
            common: {
                action: { cancel: 'Abbrechen', dismiss: 'Schließen' },
                notify: { saved: '{{what}} gespeichert.' },
                apiStatus: { retryIn_one: 'Neuer Versuch in {{count}} s.', retryIn_other: 'Neuer Versuch in {{count}} s.' },
            },
            auth: {
                consent: { answerSentTo: 'Ihre Antwort geht an <strong>{{host}}</strong>.' },
            },
        },
        ...overrides,
    };
}

/** A right-to-left pack, for the layout turning round. */
export function arabicPack(): LanguagePack {
    return {
        format: 'deadair.console-language',
        version: 1,
        locale: 'ar',
        name: 'العربية',
        direction: 'rtl',
        madeFor: '0.0.0',
        catalog: { common: { action: { cancel: 'إلغاء' } } },
    };
}
