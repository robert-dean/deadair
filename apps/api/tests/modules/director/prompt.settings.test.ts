import { describe, expect, it } from 'vitest';

import { readAnswer } from '../../../src/modules/director/break.prompt.js';
import { TEMPLATE_KEYS } from '../../../src/modules/director/break.templates.js';
import {
    speakerGuard,
    STATION_CONTEXT_KEY,
    STATION_IDENTITY_KEY,
    STATION_TEXT_MAX,
    stationPromptSettings,
} from '../../../src/modules/director/prompt.settings.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
import { STREAM_KEYS } from '../../../src/modules/stream/stream.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('stationPromptSettings', () => {
    it('carries no language for an English station, so its prompt is unchanged', () => {
        expect(stationPromptSettings(settingsConfig().config, {})).not.toHaveProperty('language');
        expect(stationPromptSettings(settingsConfig({ [STREAM_KEYS.language]: 'en-GB' }).config, {})).not.toHaveProperty('language');
    });

    it('carries the language of a station that broadcasts in another one', () => {
        expect(stationPromptSettings(settingsConfig({ [STREAM_KEYS.language]: 'de' }).config, {}).language).toBe('de');
    });

    it('reads the setting per call, so a change lands on the next break', () => {
        const { config, set } = settingsConfig();
        expect(stationPromptSettings(config, {}).language).toBeUndefined();

        set(STREAM_KEYS.language, 'fr');
        expect(stationPromptSettings(config, {}).language).toBe('fr');
    });
});

describe('the station in its own words', () => {
    it('carries who the station is and what is going on, trimmed', () => {
        const { config } = settingsConfig({
            [STATION_IDENTITY_KEY]: '  A soul station for night owls. ',
            [STATION_CONTEXT_KEY]: 'Tenth birthday this week.',
        });
        const settings = stationPromptSettings(config, {});

        expect(settings.stationIdentity).toBe('A soul station for night owls.');
        expect(settings.stationContext).toBe('Tenth birthday this week.');
    });

    it('carries nothing for a station that wrote nothing, so its prompt is unchanged', () => {
        const settings = stationPromptSettings(settingsConfig().config, {});

        expect(settings).not.toHaveProperty('stationIdentity');
        expect(settings).not.toHaveProperty('stationContext');
    });

    it('bounds a pasted essay so it cannot become most of every prompt', () => {
        const { config } = settingsConfig({ [STATION_IDENTITY_KEY]: 'x'.repeat(5000) });

        expect(stationPromptSettings(config, {}).stationIdentity).toHaveLength(STATION_TEXT_MAX);
    });
});

describe('speakerGuard', () => {
    const persona = (label: string, djName?: string) => ({ label, ...(djName === undefined ? {} : { djName }) }) as Persona;

    it('names the presenter, the station presenter and an outgoing host, once each', () => {
        const { config } = settingsConfig({ [TEMPLATE_KEYS.djName]: 'Max' });
        const guard = speakerGuard(config, {
            persona: persona('Late night', 'Sonny'),
            changeover: { outgoing: persona('Breakfast', 'Max') } as never,
        });

        expect(guard.speakers).toEqual(['Sonny', 'Late night', 'Max', 'Breakfast']);
    });

    it('asks nothing when there is nobody to name', () => {
        expect(speakerGuard(settingsConfig({ [TEMPLATE_KEYS.djName]: '' }).config, {})).toEqual({});
    });
});

describe('a break written as a script', () => {
    it('loses the presenter label in front of it, accents and all', () => {
        expect(readAnswer('Solène : bonsoir, il est minuit.', { speakers: ['Solène'] })).toBe('bonsoir, il est minuit.');
    });
});
