import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleLanguageList, ConsoleLanguagePack } from '@deadair/sdk';

import { saveDownload } from '../components/shared/download';
import { installLanguagePack, removeLanguage } from '../i18n/languages';
import { languagePackFilename, languagePackText, type LanguagePack } from '../i18n/language.pack';
import { sdk } from './client';
import { queryKeys } from './query.keys';

/** The languages this station holds packs for. Public: the sign-in page reads it too. */
export const consoleLanguagesOptions = queryOptions({
    queryKey: queryKeys.languages.list(),
    queryFn: () => sdk.languages.listConsoleLanguages(),
    staleTime: 60_000,
});

export function useConsoleLanguages() {
    return useQuery(consoleLanguagesOptions);
}

/** One language's pack as the station holds it. Public, for the same reason. */
export const consoleLanguagePackOptions = (locale: string) =>
    queryOptions({
        queryKey: queryKeys.languages.pack(locale),
        queryFn: () => sdk.languages.getConsoleLanguage(locale),
        staleTime: 5 * 60_000,
    });

export function useConsoleLanguagePack(locale: string) {
    return useQuery(consoleLanguagePackOptions(locale));
}

/**
 * The pack's own fields and nothing else, which is what the API's contract takes: it refuses a key
 * it does not know, and a translator's tools may well have added one.
 */
function asDocument(pack: LanguagePack): ConsoleLanguagePack {
    const { format, version, locale, name, direction, madeFor, catalog } = pack;
    return { format, version, locale, name, direction, madeFor, catalog };
}

/**
 * Installs a pack on the station, and in this console at once, so the language is on offer without
 * a reload. The catalog goes as the file had it, not as this console judged it: whether a string
 * fits is decided again by every console that loads it, which may be a newer one.
 */
export function useImportConsoleLanguage() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (pack: LanguagePack) => sdk.languages.importConsoleLanguage(pack.locale, asDocument(pack)),
        onSuccess: (list: ConsoleLanguageList, pack) => {
            queryClient.setQueryData(queryKeys.languages.list(), list);
            queryClient.setQueryData(queryKeys.languages.pack(pack.locale), asDocument(pack));
            installLanguagePack(pack);
        },
    });
}

/** Removes a language from the station, and from this console, which goes back to English if it was showing it. */
export function useRemoveConsoleLanguage() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (locale: string) => sdk.languages.removeConsoleLanguage(locale),
        onSuccess: async (list: ConsoleLanguageList, locale) => {
            queryClient.setQueryData(queryKeys.languages.list(), list);
            queryClient.removeQueries({ queryKey: queryKeys.languages.pack(locale) });
            await removeLanguage(locale);
        },
    });
}

/** Downloads a language as the station holds it, which is the file its translator carries on from. */
export async function exportConsoleLanguage(locale: string): Promise<void> {
    const pack = await sdk.languages.getConsoleLanguage(locale);
    saveDownload(languagePackText(pack as LanguagePack), languagePackFilename(pack), 'application/json');
}
