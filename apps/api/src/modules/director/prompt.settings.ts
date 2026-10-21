import { AppConfig } from '@maroonedsoftware/appconfig';
import { homeNames, stationLocation } from '#modules/shared/station.home.js';
import { WEATHER_KEYS } from '#modules/weather/weather.keys.js';
import { STREAM_DEFAULTS, STREAM_KEYS, stationLanguage } from '#modules/stream/stream.settings.js';
import { advisoryPolicy, speaksClean } from './advisory.policy.js';
import { TEMPLATE_KEYS } from './break.templates.js';
import type { AnswerGuard, PromptSettings } from './break.prompt.js';
import type { BreakWriteRequest } from './break.writer.js';

/** The part of a break prompt's settings that is the station's rather than the break's. */
export type StationPromptSettings = Required<Pick<PromptSettings, 'station' | 'dj' | 'cleanLanguage'>> &
    Pick<PromptSettings, 'language' | 'stationIdentity' | 'stationContext' | 'location' | 'sittingInFor' | 'coPresenters'>;

/**
 * Who the station is, in the operator's words: what it plays, who it is for, what it stands for.
 *
 * Above every show and every persona, and standing: it changes when the station does, not with the
 * hour. A persona says how the presenter talks; this says what they are talking on.
 */
export const STATION_IDENTITY_KEY = 'station.identity';

/**
 * What is true at the station right now: a move, an anniversary, a fundraiser, the snow.
 *
 * Offered as background rather than as something to say, which is the whole difference between this
 * and a brief: a fact every break was TOLD to mention would be every break.
 */
export const STATION_CONTEXT_KEY = 'station.context';

/** The longest either may be, so one pasted essay cannot become most of every prompt. */
export const STATION_TEXT_MAX = 1200;

/** A stored text setting, trimmed and bounded, or nothing when it is empty. */
const stationText = (config: AppConfig, key: string): string | undefined => {
    const value = String(config.get(key, '') ?? '').trim();
    return value === '' ? undefined : value.slice(0, STATION_TEXT_MAX);
};

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
export function stationPromptSettings(
    config: AppConfig,
    request: Pick<BreakWriteRequest, 'persona' | 'sittingInFor' | 'coPresenters'>,
): StationPromptSettings {
    const language = stationLanguage(config);
    return {
        station: config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
        // The persona's own name where it has one, and the station's behind it. A persona that is a
        // manner rather than a character has no reason to rename the presenter.
        dj: request.persona?.djName ?? config.get(TEMPLATE_KEYS.djName, ''),
        cleanLanguage: speaksClean(advisoryPolicy(config)),
        ...optional('stationIdentity', stationText(config, STATION_IDENTITY_KEY)),
        ...optional('stationContext', stationText(config, STATION_CONTEXT_KEY)),
        // Where the station is, which the weather was the only reader of. Every kind is told it,
        // because a persona's home town is otherwise the nearest answer to "where is here".
        ...optional('location', stationLocation(String(config.get(WEATHER_KEYS.location, '') ?? ''))),
        // Absent for English rather than `'en'`, so an English station's prompt is byte for byte what
        // it was before a station could broadcast in anything else.
        ...(language === undefined ? {} : { language }),
        // Whose show a guest host is sitting in on. Here rather than in each writer because it is
        // part of who is presenting, which every kind of break the presenter writes has to know.
        ...(request.sittingInFor === undefined ? {} : { sittingInFor: request.sittingInFor }),
        ...(request.coPresenters === undefined || request.coPresenters.length === 0 ? {} : { coPresenters: request.coPresenters }),
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

const optional = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> =>
    value === undefined ? {} : ({ [key]: value } as Record<K, string>);

/**
 * Who may be named in front of a script as its speaker, as a field on an answer guard.
 *
 * The presenter's on-air name and console label, the station's own name for its presenter, and, at a
 * changeover, the outgoing hosts': a model writing a handover as a scene is the one most likely to
 * put a name and a colon in front of it. See `SpeakableOptions.speakers`.
 */
export function speakerGuard(
    config: AppConfig,
    request: Pick<BreakWriteRequest, 'persona' | 'changeover' | 'coPresenters'>,
): Pick<AnswerGuard, 'speakers'> {
    const outgoing = request.changeover?.outgoing;
    // The co-presenters too: a break that mentions a co-host by name and a colon is a script reading
    // a scene, which is the same failure as naming the presenter that way.
    const names = [
        request.persona?.djName,
        request.persona?.label,
        config.get(TEMPLATE_KEYS.djName, ''),
        outgoing?.djName,
        outgoing?.label,
        ...(request.changeover?.outgoingCoHosts ?? []).flatMap(persona => [persona.djName, persona.label]),
        ...(request.coPresenters ?? []),
    ]
        .map(name => name?.trim() ?? '')
        .filter(name => name !== '');

    return names.length === 0 ? {} : { speakers: [...new Set(names)] };
}

/**
 * The places a script may call here, as a field on an answer guard: the station's location and its
 * parts, and the station's own name, so "here in Deadair country" is not read as a town.
 *
 * Beside {@link stationPromptSettings} for {@link languageGuard}'s reason: the prompt's `homeRule` and
 * this are read off the same setting, so a break is refused only for a here the prompt ruled out.
 * Present always, and empty of places for a station with no location, which is the prompt's own "claim
 * no here at all" read back.
 */
export function homeGuard(config: AppConfig): Pick<AnswerGuard, 'homes'> {
    const location = stationLocation(String(config.get(WEATHER_KEYS.location, '') ?? ''));
    const station = stationLocation(String(config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title) ?? ''));
    return { homes: [...new Set([...homeNames(location), ...homeNames(station)])] };
}

/**
 * The station's name as a field on an answer guard, read from the same setting the prompt names it from.
 *
 * Beside {@link homeGuard} for its reason: the prompt says what the station is called and the guard
 * refuses a sign-off addressed to it, so the two have to be reading one value. See `stationSignOffIn`.
 */
export function stationGuard(config: AppConfig): Pick<AnswerGuard, 'station'> {
    const station = String(config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title) ?? '').trim();
    return station === '' ? {} : { station };
}
