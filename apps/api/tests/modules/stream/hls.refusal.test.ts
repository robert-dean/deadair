// The list is an operator's judgement, and the two ways to get it wrong are opposite: too eager and
// the station refuses somebody's hi-fi, too timid and a program that never listens to anything keeps
// an audience-gated station broadcasting around the clock. Both halves are tested here because the
// setting arrives as a STRING an operator typed, which is where the sharp edges are.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { HLS_REFUSE_DEFAULT, HLS_REFUSE_KEY, agentIsRefused, parseRefusedAgents, refusesAgent } from '../../../src/modules/stream/hls.refusal.js';

const FFMPEG = 'Lavf/59.27.100';
const GO = 'Go-http-client/1.1';
const TUNEIN = 'TuneIn Radio/42.3 (Linux;Android 17) AndroidXMedia3/1.10.1';

describe('parseRefusedAgents', () => {
    it('reads a list written with spaces, commas or both', () => {
        expect(parseRefusedAgents('Lavf/ Go-http-client')).toEqual(['lavf/', 'go-http-client']);
        expect(parseRefusedAgents('Lavf/,Go-http-client')).toEqual(['lavf/', 'go-http-client']);
        expect(parseRefusedAgents('  Lavf/ ,, Go-http-client  ')).toEqual(['lavf/', 'go-http-client']);
    });

    it('answers nothing for an unset, empty or whitespace-only setting', () => {
        // The common case by far: no station refuses anybody until somebody says to.
        for (const raw of [undefined, '', '   ', ',', ' , ']) expect(parseRefusedAgents(raw)).toEqual([]);
    });

    it('deduplicates, so a list edited twice does not match twice per request', () => {
        expect(parseRefusedAgents('Lavf/ lavf/ LAVF/')).toEqual(['lavf/']);
    });
});

describe('agentIsRefused', () => {
    it('refuses nobody while the list is empty', () => {
        expect(agentIsRefused([], FFMPEG)).toBe(false);
    });

    it('matches a product token anywhere in the user agent, whatever its case', () => {
        const refused = parseRefusedAgents('lavf/ go-http-client');

        expect(agentIsRefused(refused, FFMPEG)).toBe(true);
        expect(agentIsRefused(refused, GO)).toBe(true);
    });

    it('keeps matching when the refused client updates', () => {
        // The reason the entry is a token rather than the whole string: `Lavf/59.27.100` today is
        // `Lavf/61.x` after an upgrade, and an operator should not have to come back for that.
        expect(agentIsRefused(parseRefusedAgents('Lavf/'), 'Lavf/61.7.100')).toBe(true);
    });

    it('leaves everything else alone, including a real player with a crowded user agent', () => {
        // TuneIn carries `Linux` and `Android` and a version number; nothing in the list is in it.
        expect(agentIsRefused(parseRefusedAgents('Lavf/ Go-http-client'), TUNEIN)).toBe(false);
    });

    it('never refuses a caller that sends no user agent', () => {
        // A list of names cannot match the absence of one, and hardware players that send nothing
        // are the listeners least able to work out why they went quiet.
        for (const absent of [undefined, '', '   ', 42, null]) expect(agentIsRefused(parseRefusedAgents('Lavf/'), absent)).toBe(false);
    });
});

describe('refusesAgent', () => {
    /** A config layer answering with STRINGS, which is what every real one does. */
    const configWith = (value: string | undefined): AppConfig =>
        ({ get: (key: string, fallback: unknown) => (key === HLS_REFUSE_KEY && value !== undefined ? value : fallback) }) as AppConfig;

    it('refuses what the setting names', () => {
        expect(refusesAgent(configWith('Lavf/'), FFMPEG)).toBe(true);
    });

    it('refuses nobody on an unset station, which is the default', () => {
        expect(HLS_REFUSE_DEFAULT).toBe('');
        expect(refusesAgent(configWith(undefined), FFMPEG)).toBe(false);
    });

    it('stops refusing the moment the setting is cleared', () => {
        // Read per request against a live config, so an operator emptying the field in the console
        // gets their player back on the next fetch rather than on the next restart.
        expect(refusesAgent(configWith(''), FFMPEG)).toBe(false);
    });
});
