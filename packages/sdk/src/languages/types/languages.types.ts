import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * A language pack: every word the console says, in one language, as the file a translator made. The same document is exported, imported and stored. The console's language only; what the station broadcasts in is the `stream.language` setting
 * generated from [ConsoleLanguagePack](../../../../../apps/api/data/contracts/languages/languages.types.ck#L8)
 */
export interface ConsoleLanguagePack {
    /** Says the file is a console language pack */
    format: 'deadair.console-language';
    /** The version of the document's shape. This station reads version 1 */
    version: number;
    /** The language, as a BCP 47 tag such as `de` or `pt-BR`. Never English, which is built into the console */
    locale: string;
    /** The language's name in itself, as the console's picker shows it: `Deutsch`, not `German` */
    name: string;
    /** Which way its text runs */
    direction: 'ltr' | 'rtl';
    /** The console version the pack was translated against. Empty when the file did not say */
    madeFor: string;
    /** The strings, nested by namespace and then by key, in the English catalog's shape. Every value is text or a further level of nesting */
    catalog: Record<string, unknown>;
}

/**
 * A language the console can be shown in on this station, without its strings
 * generated from [ConsoleLanguage](../../../../../apps/api/data/contracts/languages/languages.types.ck#L19)
 */
export interface ConsoleLanguage {
    locale: string;
    name: string;
    direction: 'ltr' | 'rtl';
    madeFor: string;
    /** When the pack now installed for it was imported */
    importedAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a ConsoleLanguage into its runtime type. Mutates and returns `raw`. */
export function reviveConsoleLanguage(raw: ConsoleLanguage): ConsoleLanguage {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['importedAt'] = __dt(__o0['importedAt'], 'ConsoleLanguage.importedAt');
    return raw;
}

/**
 * generated from [ConsoleLanguageList](../../../../../apps/api/data/contracts/languages/languages.types.ck#L27)
 */
export interface ConsoleLanguageList {
    /** In order of their tags. English is built in and is never listed */
    languages: ConsoleLanguage[];
}

/** Rehydrates every wire-encoded scalar in a ConsoleLanguageList into its runtime type. Mutates and returns `raw`. */
export function reviveConsoleLanguageList(raw: ConsoleLanguageList): ConsoleLanguageList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['languages'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveConsoleLanguage(__a1[__i2] as never);
        }
    }
    return raw;
}
