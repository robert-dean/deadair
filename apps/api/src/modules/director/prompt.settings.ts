import { AppConfig } from '@maroonedsoftware/appconfig';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import type { PromptSettings } from './break.prompt.js';
import type { BreakWriteRequest } from './break.writer.js';

/** The part of a break prompt's settings that is the station's rather than the break's. */
export type StationPromptSettings = Required<Pick<PromptSettings, 'station' | 'dj' | 'cleanLanguage'>>;

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
    return {
        station: config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
        // The persona's own name where it has one, and the station's behind it. A persona that is a
        // manner rather than a character has no reason to rename the presenter.
        dj: request.persona?.djName ?? config.get(TEMPLATE_KEYS.djName, ''),
        cleanLanguage: speaksClean(advisoryPolicy(config)),
    };
}
