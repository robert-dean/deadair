import { en } from './en/en.catalog.ts';

/**
 * A language pack: every word the console says, in one language, as a file somebody can hand to
 * somebody else.
 *
 * ## Why this imports nothing but the English catalog
 *
 * Node reads this file as well as the browser. The release job runs `scripts/language.template.ts`
 * with plain `node` and no install, and Node's type stripping resolves only imports that name their
 * `.ts` extension, which is why `en.catalog.ts` names its own. Anything this pulled in beyond that
 * (i18next, React, the setup module) would have to install and resolve there too.
 *
 * ## One format both ways
 *
 * A pack exported from one station, a pack imported into another, and a pack that ships inside the
 * console are the same document, so a translation that is good enough to bundle is dropped into the
 * tree as it is. The catalog has the English catalog's shape, namespace by namespace, and plural keys
 * take whatever forms the language itself has (`_few` and `_many` in Polish, only `_other` in
 * Japanese); what a given console makes of a pack is decided when it loads one, not by this type.
 */

/** What says, in the file itself, that this JSON is a console language pack. */
export const LANGUAGE_PACK_FORMAT = 'deadair.console-language';

/** The version of the document's shape. It moves only when the header changes, never with the console. */
export const LANGUAGE_PACK_VERSION = 1;

/** A catalog: strings, nested by namespace and then by component. */
export interface LanguageCatalog {
    [key: string]: string | LanguageCatalog;
}

export interface LanguagePack {
    format: typeof LANGUAGE_PACK_FORMAT;
    version: typeof LANGUAGE_PACK_VERSION;
    /** The language, as a BCP 47 tag: `de`, `pt-BR`. */
    locale: string;
    /** The language's name in itself, as the picker shows it: `Deutsch`, not `German`. */
    name: string;
    /** Which way its text runs. Arabic and Hebrew are `rtl`, and the console turns its layout round for them. */
    direction: 'ltr' | 'rtl';
    /**
     * The console version the pack was translated against. After an upgrade, what that version did
     * not have is what a translator has left to do.
     */
    madeFor: string;
    catalog: LanguageCatalog;
}

/**
 * The console's own English, as a pack.
 *
 * It is the template a translation starts from: the same keys, the English to translate, and a
 * header to change. `consoleVersion` is a parameter because the browser and the release script each
 * know it their own way.
 */
export function englishPack(consoleVersion: string): LanguagePack {
    return {
        format: LANGUAGE_PACK_FORMAT,
        version: LANGUAGE_PACK_VERSION,
        locale: 'en',
        name: 'English',
        direction: 'ltr',
        madeFor: consoleVersion,
        catalog: en,
    };
}

/** What a pack is saved as: `deadair-console-de.json`. */
export function languagePackFilename(pack: Pick<LanguagePack, 'locale'>): string {
    return `deadair-console-${pack.locale}.json`;
}

/** A pack as the text of its file: indented, with the newline at the end an editor would leave. */
export function languagePackText(pack: LanguagePack): string {
    return `${JSON.stringify(pack, undefined, 4)}\n`;
}
