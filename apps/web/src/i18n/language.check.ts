import { LANGUAGE_PACK_FORMAT, LANGUAGE_PACK_VERSION, type LanguageCatalog, type LanguagePack } from './language.pack.ts';

/**
 * What a console makes of a language pack: whether it is one at all, and if so what of it this
 * version of the console can use.
 *
 * ## The console decides, not the file and not the API
 *
 * Whether a string fits depends on the English it translates, and the English is whatever THIS
 * console was built with. So the same pack is checked when it is imported and again every time a
 * console loads it: a console upgraded since has keys the pack never saw, and may have dropped keys
 * it still carries.
 *
 * ## Reported, never refused, below the header
 *
 * A header that is wrong (not a pack, a newer format, a language that is not a language) refuses the
 * file, because there is nothing to install. Anything wrong inside the catalog costs only the string
 * it is wrong in: that string falls back to English, the check says which and why, and every other
 * string installs. That is the rule persona import settled for everything authored (Ideas #6): a
 * dangling part is reported, and the file is not thrown away over it.
 */

/** Why a file is not a pack this console can install at all. */
export type LanguagePackRefusal = 'not-a-pack' | 'newer-format' | 'bad-locale' | 'english-is-built-in' | 'no-name' | 'bad-direction' | 'no-catalog';

/** Why one string of a pack was not installed. */
export type LanguagePackFault = 'not-text' | 'placeholders' | 'markup';

export interface LanguagePackReading {
    ok: true;
    locale: string;
    name: string;
    direction: 'ltr' | 'rtl';
    madeFor: string;
    /** What installs: the pack's usable strings, in the catalog's shape. */
    catalog: LanguageCatalog;
    /** English strings the pack translates, out of all of them. A plural counts once. */
    translated: number;
    total: number;
    /** English keys the pack has no translation for. They show in English. */
    missing: string[];
    /** Keys the pack carries that this console has not got, from an older console or a typo. Dropped. */
    unknown: string[];
    /** Strings dropped for what is wrong with them. They show in English. */
    faults: { key: string; fault: LanguagePackFault }[];
}

export type LanguagePackCheck = LanguagePackReading | { ok: false; refusal: LanguagePackRefusal };

const CARDINAL = /_(zero|one|two|few|many|other)$/;
const ORDINAL = /_ordinal_(zero|one|two|few|many|other)$/;

/** Every string in a catalog, by its dotted key. */
function leaves(catalog: unknown, prefix = ''): Map<string, unknown> {
    const out = new Map<string, unknown>();
    if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) return out;
    for (const [key, value] of Object.entries(catalog)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const [inner, text] of leaves(value, path)) out.set(inner, text);
        } else {
            out.set(path, value);
        }
    }
    return out;
}

/** A key without its plural suffix, and which kind of plural it was. */
function baseOf(key: string): { base: string; plural?: 'cardinal' | 'ordinal'; category?: string } {
    const ordinal = ORDINAL.exec(key);
    if (ordinal) return { base: key.slice(0, ordinal.index), plural: 'ordinal', category: ordinal[1] };
    const cardinal = CARDINAL.exec(key);
    if (cardinal) return { base: key.slice(0, cardinal.index), plural: 'cardinal', category: cardinal[1] };
    return { base: key };
}

/** `{{name}}` and `{{count, number}}` alike, by name. */
function placeholders(text: string): Set<string> {
    return new Set([...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map(match => match[1]!));
}

/** The tag names a `<Trans>` string uses: `<code>`, `</code>` and `<code/>` are all `code`. */
function tags(text: string): Set<string> {
    return new Set([...text.matchAll(/<\/?([A-Za-z][\w-]*)\s*\/?>/g)].map(match => match[1]!));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
    return a.size === b.size && [...a].every(item => b.has(item));
}

/** Writes `text` into `catalog` at the dotted `key`. */
function place(catalog: LanguageCatalog, key: string, text: string): void {
    const parts = key.split('.');
    let node = catalog;
    for (const part of parts.slice(0, -1)) {
        const next = node[part];
        if (typeof next === 'object') {
            node = next;
        } else {
            const made: LanguageCatalog = {};
            node[part] = made;
            node = made;
        }
    }
    node[parts[parts.length - 1]!] = text;
}

/** The canonical form of a BCP 47 tag, or undefined for one that is not a tag. */
function canonicalLocale(tag: unknown): string | undefined {
    if (typeof tag !== 'string' || tag.trim() === '') return undefined;
    try {
        return Intl.getCanonicalLocales(tag)[0];
    } catch {
        return undefined;
    }
}

/**
 * Reads `file` as a language pack against `english`, the catalog of the console doing the reading.
 *
 * `file` is whatever came in, parsed JSON or not: nothing about it is trusted until this says so.
 */
export function checkLanguagePack(file: unknown, english: LanguageCatalog): LanguagePackCheck {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) return { ok: false, refusal: 'not-a-pack' };
    const pack = file as Partial<Record<keyof LanguagePack, unknown>>;

    if (pack.format !== LANGUAGE_PACK_FORMAT) return { ok: false, refusal: 'not-a-pack' };
    if (typeof pack.version !== 'number' || pack.version > LANGUAGE_PACK_VERSION) return { ok: false, refusal: 'newer-format' };

    const locale = canonicalLocale(pack.locale);
    if (locale === undefined) return { ok: false, refusal: 'bad-locale' };
    // English is built in and is what every other language falls back to, key by key. A pack that
    // replaced it would leave nothing to fall back TO for the keys it got wrong.
    if (new Intl.Locale(locale).language === 'en') return { ok: false, refusal: 'english-is-built-in' };

    if (typeof pack.name !== 'string' || pack.name.trim() === '') return { ok: false, refusal: 'no-name' };
    if (pack.direction !== 'ltr' && pack.direction !== 'rtl') return { ok: false, refusal: 'bad-direction' };
    if (pack.catalog === null || typeof pack.catalog !== 'object' || Array.isArray(pack.catalog)) return { ok: false, refusal: 'no-catalog' };

    // The English forms of each key, grouped under the key without its plural suffix.
    const englishForms = new Map<string, { plural?: 'cardinal' | 'ordinal'; texts: string[] }>();
    for (const [key, text] of leaves(english)) {
        const { base, plural } = baseOf(key);
        const entry = englishForms.get(base) ?? { plural, texts: [] };
        entry.texts.push(String(text));
        englishForms.set(base, entry);
    }

    // The plural forms THIS language has, which is the browser's to say rather than a table's.
    // `zero` is always allowed: i18next offers it to every language for "no items" wording.
    const categories = {
        cardinal: new Set(['zero', ...new Intl.PluralRules(locale).resolvedOptions().pluralCategories]),
        ordinal: new Set(['zero', ...new Intl.PluralRules(locale, { type: 'ordinal' }).resolvedOptions().pluralCategories]),
    };

    const catalog: LanguageCatalog = {};
    const translatedBases = new Set<string>();
    const unknown: string[] = [];
    const faults: LanguagePackReading['faults'] = [];

    for (const [key, value] of leaves(pack.catalog)) {
        const { base, plural, category } = baseOf(key);
        const forms = englishForms.get(base);
        const fits = forms !== undefined && forms.plural === plural && (plural === undefined || categories[plural].has(category!));
        if (!fits) {
            unknown.push(key);
            continue;
        }
        if (typeof value !== 'string') {
            faults.push({ key, fault: 'not-text' });
            continue;
        }

        // A placeholder the English never fills renders as literal braces, and one the English
        // always has (other than `count`, which a singular may spell out) is information lost.
        const offered = new Set(forms.texts.flatMap(text => [...placeholders(text)]));
        const always = [...placeholders(forms.texts[0]!)].filter(name => name !== 'count' && forms.texts.every(text => placeholders(text).has(name)));
        const used = placeholders(value);
        if ([...used].some(name => !offered.has(name)) || always.some(name => !used.has(name))) {
            faults.push({ key, fault: 'placeholders' });
            continue;
        }

        // A tag the code does not supply renders as text, and a missing one loses what it wrapped:
        // a link with no words is a link nobody can click.
        const englishTags = new Set(forms.texts.flatMap(text => [...tags(text)]));
        if (!sameSet(tags(value), englishTags)) {
            faults.push({ key, fault: 'markup' });
            continue;
        }

        place(catalog, key, value);
        // A plural counts as translated by its `other` form, which every language has.
        if (plural === undefined || category === 'other') translatedBases.add(base);
    }

    const missing = [...englishForms.entries()]
        .filter(([base]) => !translatedBases.has(base))
        .map(([base, forms]) => (forms.plural === 'ordinal' ? `${base}_ordinal_other` : forms.plural === 'cardinal' ? `${base}_other` : base));

    return {
        ok: true,
        locale,
        name: pack.name.trim(),
        direction: pack.direction,
        madeFor: typeof pack.madeFor === 'string' ? pack.madeFor : '',
        catalog,
        translated: translatedBases.size,
        total: englishForms.size,
        missing,
        unknown,
        faults,
    };
}
