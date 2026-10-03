import { describe, expect, it } from 'vitest';

import { settingOf, voiceMapOf, voiceRowsAreComplete } from '../src/elevenlabs.voices.js';

const rows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

describe('voiceMapOf', () => {
    it('maps each station voice to its ElevenLabs voice and the settings it set', () => {
        expect(voiceMapOf(rows({ name: 'host', voice: 'v1', stability: '0.3', similarity: '0.8' }, { name: 'news', voice: 'v2' }))).toEqual({
            host: { voice: 'v1', settings: { stability: 0.3, similarity_boost: 0.8 } },
            news: { voice: 'v2', settings: {} },
        });
    });

    it('drops a row missing either half', () => {
        expect(voiceMapOf(rows({ name: 'host' }, { voice: 'v1' }, { name: 'news', voice: 'v2' }))).toEqual({ news: { voice: 'v2', settings: {} } });
    });

    it('answers an empty map for anything unreadable', () => {
        expect(voiceMapOf(undefined)).toEqual({});
        expect(voiceMapOf('not json')).toEqual({});
        expect(voiceMapOf('[]')).toEqual({});
    });
});

describe('settingOf', () => {
    it('reads a number and clamps it into the range the API takes', () => {
        expect(settingOf('0.5', 'stability')).toBe(0.5);
        expect(settingOf('1.5', 'stability')).toBe(1);
        expect(settingOf('-1', 'similarity_boost')).toBe(0);
        expect(settingOf('2', 'speed')).toBe(1.2);
        expect(settingOf('0.1', 'speed')).toBe(0.7);
    });

    it('answers nothing for a blank or non-numeric cell', () => {
        expect(settingOf(undefined, 'style')).toBeUndefined();
        expect(settingOf('  ', 'style')).toBeUndefined();
        expect(settingOf('fast', 'speed')).toBeUndefined();
    });
});

describe('voiceRowsAreComplete', () => {
    it('passes complete rows, nothing at all, and an abandoned empty row', () => {
        expect(voiceRowsAreComplete(undefined)).toBe(true);
        expect(voiceRowsAreComplete(rows({ name: 'host', voice: 'v1' }))).toBe(true);
        expect(voiceRowsAreComplete(rows({ name: '', voice: '' }))).toBe(true);
    });

    it('refuses a row with only one half', () => {
        expect(voiceRowsAreComplete(rows({ name: 'host', stability: '0.5' }))).toBe(false);
        expect(voiceRowsAreComplete(rows({ voice: 'v1' }))).toBe(false);
    });
});
