import { AppConfig } from '@maroonedsoftware/appconfig';
import { STREAM_DEFAULTS, STREAM_KEYS, stationLanguage } from '#modules/stream/stream.settings.js';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import type { AnswerGuard, PromptSettings } from './break.prompt.js';
import type { BreakWriteRequest } from './break.writer.js';

/** The part of a break prompt's settings that is the station's rather than the break's. */
export type StationPromptSettings = Required<Pick<PromptSettings, 'station' | 'dj' | 'cleanLanguage'>> & Pick<PromptSettings, 'language'>;

/**
 * What every model writer tells the model about the station, read from the config for one break.
 *
 * One function because eight writers were building this by hand, three settings at a time, and a
 * fourth station-wide fact would have had to be added eight times with nothing to catch the one
 * that was missed. Each writer spreads it and adds what is its own: the word ceiling, the persona's
 * sheet, the story.
 *
 * Read per break, like every other setting a writer reads, so an operator's change lands on the
 * next break rather than after a restart.
 */
export function stationPromptSettings(config: AppConfig, request: Pick<BreakWriteRequest, 'persona'>): StationPromptSettings {
    const language = stationLanguage(config);
    return {
        station: config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
        // The persona's own name where it has one, and the station's behind it. A persona that is a
        // manner rather than a character has no reason to rename the presenter.
        dj: request.persona?.djName ?? config.get(TEMPLATE_KEYS.djName, ''),
        cleanLanguage: speaksClean(advisoryPolicy(config)),
        // Absent for English rather than `'en'`, so an English station's prompt is byte for byte what
        // it was before a station could broadcast in anything else.
        ...(language === undefined ? {} : { language }),
    };
}

/**
 * The station's language as a field on an answer guard, or nothing for English.
 *
 * Beside {@link stationPromptSettings} because the two have to agree: a break asked for in German and
 * then checked as though it were English is refused for every English word it did not use.
 */
export function languageGuard(config: AppConfig): Pick<AnswerGuard, 'language'> {
    const language = stationLanguage(config);
    return language === undefined ? {} : { language };
}
