import { formatLocale } from '../../i18n/format.locale';

/**
 * The station's broadcast language as a sheet language is compared with it: `en` where the setting is empty,
 * which is what the station reads an empty `stream.language` as.
 */
export const stationLanguageOf = (setting: unknown): string => (typeof setting === 'string' && setting.trim() !== '' ? setting.trim() : 'en');

/**
 * Whether a sheet in `sheet` is in the station's language, compared by language and not region, as the
 * station compares them (`sheetSpeaks` in the API). An empty field is a match: a new character takes the
 * station's language when it is saved without one.
 */
export function sheetMatches(sheet: string, station: string): boolean {
    const primary = (tag: string): string => tag.trim().split('-')[0]!.toLowerCase();
    return sheet.trim() === '' || primary(sheet) === primary(station);
}

/** A language tag as the operator's console would name it ("German" for `de`), or the tag itself. */
export function languageLabel(tag: string): string {
    try {
        return new Intl.DisplayNames([formatLocale()], { type: 'language' }).of(tag.trim()) ?? tag;
    } catch {
        return tag;
    }
}
