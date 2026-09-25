import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A language pack: every word the console says, in one language, as the file a translator made. The same document is exported, imported and stored. The console's language only; what the station broadcasts in is the `stream.language` setting
 * generated from [ConsoleLanguagePack](../../../../data/contracts/languages/languages.types.ck#L8)
 */
export const ConsoleLanguagePack = z.strictObject({
    format: z.literal('deadair.console-language').describe('Says the file is a console language pack'),
    version: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .describe("The version of the document's shape. This station reads version 1"),
    locale: z
        .string()
        .min(2)
        .max(35)
        .describe('The language, as a BCP 47 tag such as `de` or `pt-BR`. Never English, which is built into the console'),
    name: z.string().min(1).max(100).describe("The language's name in itself, as the console's picker shows it: `Deutsch`, not `German`"),
    direction: z.enum(['ltr', 'rtl']).describe('Which way its text runs'),
    madeFor: z.string().max(50).describe('The console version the pack was translated against. Empty when the file did not say'),
    catalog: z
        .record(z.string(), z.unknown())
        .describe(
            "The strings, nested by namespace and then by key, in the English catalog's shape. Every value is text or a further level of nesting",
        ),
});
export type ConsoleLanguagePack = z.infer<typeof ConsoleLanguagePack>;

/**
 * A language the console can be shown in on this station, without its strings
 * generated from [ConsoleLanguage](../../../../data/contracts/languages/languages.types.ck#L19)
 */
export const ConsoleLanguage = z.strictObject({
    locale: z.string().min(2).max(35),
    name: z.string().min(1).max(100),
    direction: z.enum(['ltr', 'rtl']),
    madeFor: z.string().max(50),
    importedAt: _ZodDatetime.describe('When the pack now installed for it was imported'),
});
export type ConsoleLanguage = z.infer<typeof ConsoleLanguage>;

/**
 * generated from [ConsoleLanguageList](../../../../data/contracts/languages/languages.types.ck#L27)
 */
export const ConsoleLanguageList = z.strictObject({
    languages: z.array(ConsoleLanguage).describe('In order of their tags. English is built in and is never listed'),
});
export type ConsoleLanguageList = z.infer<typeof ConsoleLanguageList>;
