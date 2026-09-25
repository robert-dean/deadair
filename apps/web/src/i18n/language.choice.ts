/**
 * Which language the console shows, from what the operator chose, what the browser prefers and what
 * the station has.
 *
 * In that order. A choice the operator made wins, English included: choosing English is how
 * somebody whose browser prefers German keeps an English console. Without one, the browser's own
 * preferences are read in its order, and the first the station can show wins; English counts as one
 * the station can show, so a browser preferring English before German gets English. With nothing
 * matched, English, which is always there.
 *
 * A choice naming a language the station no longer holds (an admin removed it) is no choice, and the
 * browser decides again.
 */
export function chooseLanguage(input: { chosen?: string; preferred: readonly string[]; available: readonly string[] }): string {
    const available = ['en', ...input.available];
    const find = (tag: string) => available.find(locale => locale.toLowerCase() === tag.toLowerCase());
    const language = (tag: string) => tag.toLowerCase().split('-')[0];

    if (input.chosen !== undefined) {
        const chosen = find(input.chosen);
        if (chosen !== undefined) return chosen;
    }

    for (const tag of input.preferred) {
        // `pt-BR` wants the Brazilian pack before the European one, and either before nothing.
        const exact = find(tag);
        if (exact !== undefined) return exact;
        const near = available.find(locale => language(locale) === language(tag));
        if (near !== undefined) return near;
    }

    return 'en';
}

const STORAGE_KEY = 'deadair.consoleLanguage';

/**
 * The language chosen on this browser, remembered so the sign-in page is in it before anybody has
 * signed in. The account holds the real choice; this is its last known copy. Storage that throws
 * (a private window, blocked site data) is read as no choice.
 */
export function rememberedChoice(): string | undefined {
    try {
        return localStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
        return undefined;
    }
}

/** Remembers a choice on this browser, or with `undefined` forgets it. */
export function rememberChoice(locale: string | undefined): void {
    try {
        if (locale === undefined) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, locale);
    } catch {
        // Nothing to do: the account still holds the choice, and it is read again after sign-in.
    }
}
