import { httpError } from '@maroonedsoftware/errors';

/** The version of the pack document this station reads. */
export const LANGUAGE_PACK_VERSION = 1;

/**
 * How big a catalog may be. The console's own English is about 200 KB and 2,400 strings, so these
 * leave a translation room to be longer than English, as most are, and stop a file that is not a
 * catalog at all from being stored as one.
 */
export const CATALOG_LIMITS = { bytes: 2_000_000, strings: 20_000, depth: 8, stringLength: 10_000 } as const;

/**
 * A language tag in its canonical form (`pt-br` becomes `pt-BR`), or `undefined` for text that is not
 * a BCP 47 tag.
 */
export function canonicalLocale(tag: string): string | undefined {
    try {
        return Intl.getCanonicalLocales(tag.trim())[0];
    } catch {
        return undefined;
    }
}

/**
 * The language from a path, canonical, refusing text that is not a language tag.
 *
 * @throws 400 for a tag that is not one.
 */
export function requireLocale(tag: string): string {
    const locale = canonicalLocale(tag);
    if (locale === undefined) throw httpError(400).withDetails({ message: `"${tag}" is not a language tag` });
    return locale;
}

/**
 * Refuses a catalog the API should not store: anything but text and nesting, deeper than a catalog
 * nests, or bigger than a console could be translated into.
 *
 * Only the SHAPE. Whether a string fits the English it translates is the console's to say, since the
 * English is whatever that console was built with; `apps/web/src/i18n/language.check.ts` decides it.
 *
 * @throws 400 naming the first thing wrong.
 */
export function assertStorableCatalog(catalog: Record<string, unknown>): void {
    if (JSON.stringify(catalog).length > CATALOG_LIMITS.bytes) {
        throw httpError(400).withDetails({ message: `the catalog is larger than ${CATALOG_LIMITS.bytes.toLocaleString('en')} bytes` });
    }

    let strings = 0;
    const walk = (node: Record<string, unknown>, path: string, depth: number): void => {
        if (depth > CATALOG_LIMITS.depth) throw httpError(400).withDetails({ message: `"${path}" nests deeper than ${CATALOG_LIMITS.depth} levels` });
        for (const [key, value] of Object.entries(node)) {
            const at = path === '' ? key : `${path}.${key}`;
            if (typeof value === 'string') {
                strings += 1;
                if (value.length > CATALOG_LIMITS.stringLength) {
                    throw httpError(400).withDetails({
                        message: `"${at}" is longer than ${CATALOG_LIMITS.stringLength.toLocaleString('en')} characters`,
                    });
                }
            } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                walk(value as Record<string, unknown>, at, depth + 1);
            } else {
                throw httpError(400).withDetails({ message: `"${at}" is neither text nor a group of strings` });
            }
        }
    };
    walk(catalog, '', 1);

    if (strings > CATALOG_LIMITS.strings) {
        throw httpError(400).withDetails({ message: `the catalog holds more than ${CATALOG_LIMITS.strings.toLocaleString('en')} strings` });
    }
}
