import { useEffect } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleLanguageChoice, ConsoleLanguageList, ConsoleLanguagePack } from '@deadair/sdk';

import { saveDownload } from '../components/shared/download';
import { chooseLanguage, rememberChoice, rememberedChoice } from '../i18n/language.choice';
import { availableLanguages, installLanguagePack, removeLanguage, showLanguage } from '../i18n/languages';
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

/**
 * Shows the console in `locale`, loading its pack from the station first if this console has not got
 * it. English needs nothing. A language whose pack cannot be had (removed since, or the station is
 * away) leaves the console as it is, and the failure is the caller's to report or swallow.
 */
export async function applyLanguage(locale: string): Promise<void> {
    if (locale !== 'en' && !availableLanguages().some(language => language.locale === locale)) {
        const check = installLanguagePack(await sdk.languages.getConsoleLanguage(locale));
        if (!check.ok) throw new Error(`the ${locale} pack is not one this console can use: ${check.refusal}`);
    }
    await showLanguage(locale);
}

/**
 * Puts the console in its language at start-up, before anybody has signed in: the choice remembered
 * on this browser, else the browser's own preference among the languages the station has, else
 * English.
 *
 * The console draws in English until this finishes, rather than holding the first frame for a
 * request: a station that is slow or away still gets a console, and the words change under it once.
 * The account's own choice, which may differ, is applied after sign-in by `useAccountLanguage`.
 */
export async function startConsoleLanguage(): Promise<void> {
    try {
        const { languages } = await sdk.languages.listConsoleLanguages();
        const target = chooseLanguage({
            chosen: rememberedChoice(),
            preferred: navigator.languages,
            available: languages.map(language => language.locale),
        });
        await applyLanguage(target);
    } catch {
        // English, which is already on screen.
    }
}

/** The language the signed-in operator chose for their console, if they chose one. */
export const consoleLanguageChoiceOptions = queryOptions({
    queryKey: queryKeys.languages.choice(),
    queryFn: () => sdk.languages.getMyConsoleLanguage(),
    staleTime: Infinity,
});

export function useConsoleLanguageChoice(enabled = true) {
    return useQuery({ ...consoleLanguageChoiceOptions, enabled });
}

/**
 * Once somebody is signed in, shows the console in the language their account chose, and remembers
 * it on this browser for the next sign-in page. Nothing happens for an account that never chose:
 * whatever start-up picked from the browser stands.
 */
export function useAccountLanguage(signedIn: boolean): void {
    const choice = useConsoleLanguageChoice(signedIn);
    const locale = choice.data?.locale;

    useEffect(() => {
        if (locale === undefined) return;
        rememberChoice(locale);
        // A choice whose pack has gone since is a console that stays as it is.
        applyLanguage(locale).catch(() => undefined);
    }, [locale]);
}

/**
 * Chooses the console's language for the signed-in operator, or with `undefined` goes back to
 * following the browser. The console changes at once and this browser remembers it; the account
 * keeps it for every other browser. If the station refuses to keep it, the console still shows the
 * language here, and the refusal is reported.
 */
export function useChooseConsoleLanguage() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (locale: string | undefined): Promise<ConsoleLanguageChoice> => {
            rememberChoice(locale);
            const available =
                queryClient.getQueryData<ConsoleLanguageList>(queryKeys.languages.list())?.languages.map(language => language.locale) ?? [];
            await applyLanguage(locale ?? chooseLanguage({ preferred: navigator.languages, available }));
            return sdk.languages.chooseMyConsoleLanguage(locale === undefined ? {} : { locale });
        },
        onSuccess: choice => queryClient.setQueryData(queryKeys.languages.choice(), choice),
    });
}
